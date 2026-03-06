use spacetimedb::{ReducerContext, ScheduleAt, Table};

const NUM_SYSTEMS: u32 = 10;
const SLOTS_PER_SYSTEM: u32 = 8;
const RESOURCE_TICK_INTERVAL_US: u64 = 60_000_000;

// Travel speed: 1 orbital unit per this many microseconds.
// Planets are 50–260 orbital units apart within a system; systems are 200–920 units apart.
// We want a cross-system trip to take roughly 10–30 minutes.
// 1 unit / 60_000 us  →  1000 units in 60 seconds = 1 minute, so 800 units ≈ 48 min.
const TRAVEL_SPEED_US_PER_UNIT: f64 = 60_000.0;

// Encounter outcome types (stored as string in ReturnMission / ExpeditionLog)
// "resources"    — found iron/plasma/crystals
// "ruins"        — ancient ruins, large resource bonus
// "anomaly"      — crystal anomaly, small crystal bonus
// "empty"        — nothing found, explorer returns
// "delayed"      — ship gets lost, returns much later with nothing

#[spacetimedb::table(accessor = game_config, public)]
pub struct GameConfig {
    #[primary_key]
    pub id: u32,
    pub num_systems: u32,
    pub slots_per_system: u32,
    pub galaxy_radius: f64,
    pub initialized: bool,
}

#[spacetimedb::table(accessor = solar_system, public)]
pub struct SolarSystem {
    #[primary_key]
    #[auto_inc]
    pub id: u32,
    pub system_index: u32,
    pub orbital_radius: f64,
    pub initial_angle: f64,
    pub orbital_speed: f64,
}

#[spacetimedb::table(
    accessor = planet,
    public,
    index(accessor = planet_system_id, btree(columns = [system_id])),
    index(accessor = planet_owner, btree(columns = [owner_id]))
)]
#[derive(Clone)]
pub struct Planet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub system_id: u32,
    pub slot_index: u32,
    pub orbital_radius: f64,
    pub initial_angle: f64,
    pub orbital_speed: f64,
    pub owner_id: Option<spacetimedb::Identity>,
    pub name: Option<String>,
    pub iron: f64,
    pub plasma: f64,
    pub crystals: f64,
    pub last_updated: spacetimedb::Timestamp,
}

#[spacetimedb::table(
    accessor = building,
    public,
    index(accessor = building_planet_id, btree(columns = [planet_id]))
)]
pub struct Building {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub planet_id: u64,
    pub building_type: String,
    pub level: u32,
}

#[spacetimedb::table(accessor = player, public)]
pub struct Player {
    #[primary_key]
    pub identity: spacetimedb::Identity,
    pub name: Option<String>,
    pub planet_id: Option<u64>,
    pub online: bool,
}

#[spacetimedb::table(
    accessor = build_queue,
    public,
    scheduled(finish_build),
    index(accessor = build_queue_planet_id, btree(columns = [planet_id]))
)]
pub struct BuildQueue {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub planet_id: u64,
    pub building_type: String,
    pub target_level: u32,
}

#[spacetimedb::table(accessor = fleet, public)]
pub struct Fleet {
    #[primary_key]
    pub owner_id: spacetimedb::Identity,
    pub explorer_count: u32,
}

#[spacetimedb::table(
    accessor = fleet_mission,
    public,
    scheduled(arrive_fleet),
    index(accessor = fleet_mission_owner, btree(columns = [owner_id]))
)]
pub struct FleetMission {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub owner_id: spacetimedb::Identity,
    pub source_planet_id: u64,
    pub target_planet_id: u64,
}

#[spacetimedb::table(
    accessor = return_mission,
    public,
    scheduled(return_fleet),
    index(accessor = return_mission_owner, btree(columns = [owner_id]))
)]
pub struct ReturnMission {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub owner_id: spacetimedb::Identity,
    pub home_planet_id: u64,
    pub result_type: String,
    pub loot_iron: f64,
    pub loot_plasma: f64,
    pub loot_crystals: f64,
}

#[spacetimedb::table(
    accessor = expedition_log,
    public,
    index(accessor = expedition_log_owner, btree(columns = [owner_id]))
)]
pub struct ExpeditionLog {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_id: spacetimedb::Identity,
    pub home_planet_id: u64,
    pub result_type: String,
    pub loot_iron: f64,
    pub loot_plasma: f64,
    pub loot_crystals: f64,
    pub completed_at: spacetimedb::Timestamp,
}

#[spacetimedb::table(
    accessor = visitor_log,
    public,
    index(accessor = visitor_log_planet_owner, btree(columns = [planet_owner_id]))
)]
pub struct VisitorLog {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub planet_owner_id: spacetimedb::Identity,
    pub visited_planet_id: u64,
    pub visitor_identity: spacetimedb::Identity,
    pub visitor_name: Option<String>,
    pub arrived_at: spacetimedb::Timestamp,
}

#[spacetimedb::table(accessor = resource_tick, scheduled(tick_resources))]
pub struct ResourceTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

fn building_base_costs(building_type: &str) -> Option<(f64, f64, f64)> {
    match building_type {
        "iron_mine" => Some((60.0, 15.0, 0.0)),
        "plasma_extractor" => Some((0.0, 40.0, 30.0)),
        "crystal_farm" => Some((20.0, 0.0, 40.0)),
        "shipyard" => Some((400.0, 200.0, 100.0)),
        "research_lab" => Some((200.0, 100.0, 150.0)),
        _ => None,
    }
}

fn building_cost(building_type: &str, target_level: u32) -> Result<(f64, f64, f64), String> {
    let (bi, bp, bc) = building_base_costs(building_type)
        .ok_or_else(|| format!("Unknown building type: {}", building_type))?;
    let factor = 1.5_f64.powi(target_level as i32 - 1);
    Ok((
        (bi * factor).floor(),
        (bp * factor).floor(),
        (bc * factor).floor(),
    ))
}

fn build_time_us(building_type: &str, target_level: u32) -> Result<u64, String> {
    let base_s: f64 = match building_type {
        "iron_mine" => 30.0,
        "plasma_extractor" => 60.0,
        "crystal_farm" => 45.0,
        "shipyard" => 120.0,
        "research_lab" => 90.0,
        _ => return Err(format!("Unknown building type: {}", building_type)),
    };
    let seconds = (base_s * 2.0_f64.powi(target_level as i32 - 1)).floor() as u64;
    Ok(seconds * 1_000_000)
}

fn production_per_minute(building_type: &str, level: u32) -> (f64, f64, f64) {
    let level = level as f64;
    match building_type {
        "iron_mine" => (30.0 * level, 0.0, 0.0),
        "plasma_extractor" => (0.0, 20.0 * level, 0.0),
        "crystal_farm" => (0.0, 0.0, 15.0 * level),
        _ => (0.0, 0.0, 0.0),
    }
}

const EXPLORER_COST_IRON: f64 = 300.0;
const EXPLORER_COST_PLASMA: f64 = 150.0;
const EXPLORER_COST_CRYSTALS: f64 = 100.0;

fn planet_world_pos(planet: &Planet, system: &SolarSystem, now_secs: f64) -> (f64, f64) {
    let galaxy_center = 500.0_f64;
    let sys_angle = system.initial_angle + system.orbital_speed * now_secs;
    let sys_x = galaxy_center + system.orbital_radius * sys_angle.cos();
    let sys_y = galaxy_center + system.orbital_radius * sys_angle.sin();
    let pl_angle = planet.initial_angle + planet.orbital_speed * now_secs;
    let pl_x = sys_x + planet.orbital_radius * pl_angle.cos();
    let pl_y = sys_y + planet.orbital_radius * pl_angle.sin();
    (pl_x, pl_y)
}

#[spacetimedb::reducer]
pub fn finish_build(ctx: &ReducerContext, arg: BuildQueue) -> Result<(), String> {
    if ctx.db.planet().id().find(&arg.planet_id).is_none() {
        return Ok(());
    }

    let existing = ctx
        .db
        .building()
        .building_planet_id()
        .filter(&arg.planet_id)
        .find(|b| b.building_type == arg.building_type);

    if let Some(b) = existing {
        ctx.db.building().id().update(Building {
            level: arg.target_level,
            ..b
        });
    } else {
        ctx.db.building().insert(Building {
            id: 0,
            planet_id: arg.planet_id,
            building_type: arg.building_type,
            level: arg.target_level,
        });
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn arrive_fleet(ctx: &ReducerContext, arg: FleetMission) -> Result<(), String> {
    let target = ctx.db.planet().id().find(&arg.target_planet_id);
    let source = ctx.db.planet().id().find(&arg.source_planet_id);

    let now_micros = ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64;

    let (result_type, loot_iron, loot_plasma, loot_crystals, return_delay_us) =
        roll_encounter(now_micros, target.as_ref(), source.as_ref());

    let arrive_back = ctx.timestamp + std::time::Duration::from_micros(return_delay_us);

    if let Some(ref t) = target {
        if let Some(target_owner_id) = t.owner_id {
            if target_owner_id != arg.owner_id {
                let visitor_name = ctx
                    .db
                    .player()
                    .identity()
                    .find(arg.owner_id)
                    .and_then(|p| p.name);
                ctx.db.visitor_log().insert(VisitorLog {
                    id: 0,
                    planet_owner_id: target_owner_id,
                    visited_planet_id: arg.target_planet_id,
                    visitor_identity: arg.owner_id,
                    visitor_name,
                    arrived_at: ctx.timestamp,
                });
            }
        }
    }

    ctx.db.return_mission().insert(ReturnMission {
        scheduled_id: 0,
        scheduled_at: arrive_back.into(),
        owner_id: arg.owner_id,
        home_planet_id: arg.source_planet_id,
        result_type,
        loot_iron,
        loot_plasma,
        loot_crystals,
    });

    Ok(())
}

fn roll_encounter(
    seed: u64,
    target: Option<&Planet>,
    source: Option<&Planet>,
) -> (String, f64, f64, f64, u64) {
    let roll = (seed / 1_000) % 100;

    let dist_factor = match (target, source) {
        (Some(t), Some(s)) => {
            let dx = t.orbital_radius as f64 - s.orbital_radius as f64;
            let dy = (t.system_id as f64 - s.system_id as f64) * 80.0;
            let d = (dx * dx + dy * dy).sqrt().max(1.0);
            (d / 200.0).clamp(0.5, 5.0)
        }
        _ => 1.0,
    };

    match roll {
        0..=34 => {
            let base_iron = 120.0 * dist_factor;
            let base_plasma = 60.0 * dist_factor;
            let base_crystals = 40.0 * dist_factor;
            (
                "resources".to_string(),
                base_iron.floor(),
                base_plasma.floor(),
                base_crystals.floor(),
                base_return_delay_us(dist_factor),
            )
        }
        35..=44 => {
            let base_iron = 400.0 * dist_factor;
            let base_plasma = 200.0 * dist_factor;
            let base_crystals = 150.0 * dist_factor;
            (
                "ruins".to_string(),
                base_iron.floor(),
                base_plasma.floor(),
                base_crystals.floor(),
                base_return_delay_us(dist_factor),
            )
        }
        45..=59 => (
            "anomaly".to_string(),
            0.0,
            0.0,
            (80.0 * dist_factor).floor(),
            base_return_delay_us(dist_factor),
        ),
        60..=79 => (
            "empty".to_string(),
            0.0,
            0.0,
            0.0,
            base_return_delay_us(dist_factor),
        ),
        _ => (
            "delayed".to_string(),
            0.0,
            0.0,
            0.0,
            base_return_delay_us(dist_factor) * 3,
        ),
    }
}

fn base_return_delay_us(dist_factor: f64) -> u64 {
    let base_secs = 60.0 * dist_factor;
    (base_secs * 1_000_000.0) as u64
}

#[spacetimedb::reducer]
pub fn return_fleet(ctx: &ReducerContext, arg: ReturnMission) -> Result<(), String> {
    if let Some(home) = ctx.db.planet().id().find(&arg.home_planet_id) {
        if home.owner_id == Some(arg.owner_id)
            && (arg.loot_iron > 0.0 || arg.loot_plasma > 0.0 || arg.loot_crystals > 0.0)
        {
            ctx.db.planet().id().update(Planet {
                iron: home.iron + arg.loot_iron,
                plasma: home.plasma + arg.loot_plasma,
                crystals: home.crystals + arg.loot_crystals,
                ..home
            });
        }
    }

    if let Some(fleet) = ctx.db.fleet().owner_id().find(&arg.owner_id) {
        ctx.db.fleet().owner_id().update(Fleet {
            explorer_count: fleet.explorer_count + 1,
            ..fleet
        });
    } else {
        ctx.db.fleet().insert(Fleet {
            owner_id: arg.owner_id,
            explorer_count: 1,
        });
    }

    ctx.db.expedition_log().insert(ExpeditionLog {
        id: 0,
        owner_id: arg.owner_id,
        home_planet_id: arg.home_planet_id,
        result_type: arg.result_type,
        loot_iron: arg.loot_iron,
        loot_plasma: arg.loot_plasma,
        loot_crystals: arg.loot_crystals,
        completed_at: ctx.timestamp,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn tick_resources(ctx: &ReducerContext, _arg: ResourceTick) -> Result<(), String> {
    let now_micros = ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64;

    let owned_planets: Vec<Planet> = ctx
        .db
        .planet()
        .iter()
        .filter(|p| p.owner_id.is_some())
        .collect();

    for p in owned_planets {
        let last_micros = p
            .last_updated
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_micros() as u64;

        let elapsed_us = now_micros.saturating_sub(last_micros);
        let elapsed_minutes = elapsed_us as f64 / 60_000_000.0;

        let mut d_iron = 0.0_f64;
        let mut d_plasma = 0.0_f64;
        let mut d_crystals = 0.0_f64;

        for b in ctx.db.building().building_planet_id().filter(&p.id) {
            let (pi, pp, pc) = production_per_minute(&b.building_type, b.level);
            d_iron += pi * elapsed_minutes;
            d_plasma += pp * elapsed_minutes;
            d_crystals += pc * elapsed_minutes;
        }

        ctx.db.planet().id().update(Planet {
            iron: p.iron + d_iron,
            plasma: p.plasma + d_plasma,
            crystals: p.crystals + d_crystals,
            last_updated: ctx.timestamp,
            ..p
        });
    }

    let next_tick_time =
        ctx.timestamp + std::time::Duration::from_micros(RESOURCE_TICK_INTERVAL_US);
    ctx.db.resource_tick().insert(ResourceTick {
        scheduled_id: 0,
        scheduled_at: next_tick_time.into(),
    });

    Ok(())
}

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    if let Some(cfg) = ctx.db.game_config().id().find(&0u32) {
        if cfg.initialized {
            return;
        }
    }

    ctx.db.game_config().insert(GameConfig {
        id: 0,
        num_systems: NUM_SYSTEMS,
        slots_per_system: SLOTS_PER_SYSTEM,
        galaxy_radius: 1000.0,
        initialized: false,
    });

    for s in 0..NUM_SYSTEMS {
        let orbital_radius = 200.0 + s as f64 * 80.0;
        let initial_angle = (2.0 * std::f64::consts::PI * s as f64) / NUM_SYSTEMS as f64;
        let orbital_speed = 0.0001 + s as f64 * 0.00005;

        ctx.db.solar_system().insert(SolarSystem {
            id: 0,
            system_index: s,
            orbital_radius,
            initial_angle,
            orbital_speed,
        });
    }

    for s in 0..NUM_SYSTEMS {
        let system_id = s + 1;
        for slot in 0..SLOTS_PER_SYSTEM {
            let orbital_radius = 50.0 + slot as f64 * 30.0;
            let initial_angle =
                (2.0 * std::f64::consts::PI * slot as f64) / SLOTS_PER_SYSTEM as f64;
            let orbital_speed = 0.002 - slot as f64 * 0.0001;

            ctx.db.planet().insert(Planet {
                id: 0,
                system_id,
                slot_index: slot,
                orbital_radius,
                initial_angle,
                orbital_speed,
                owner_id: None,
                name: None,
                iron: 500.0,
                plasma: 200.0,
                crystals: 100.0,
                last_updated: ctx.timestamp,
            });
        }
    }

    let first_tick = ctx.timestamp + std::time::Duration::from_micros(RESOURCE_TICK_INTERVAL_US);
    ctx.db.resource_tick().insert(ResourceTick {
        scheduled_id: 0,
        scheduled_at: first_tick.into(),
    });

    if let Some(cfg) = ctx.db.game_config().id().find(&0u32) {
        ctx.db.game_config().id().update(GameConfig {
            initialized: true,
            ..cfg
        });
    }
}

#[spacetimedb::reducer]
pub fn upgrade_building(
    ctx: &ReducerContext,
    planet_id: u64,
    building_type: String,
) -> Result<(), String> {
    if building_base_costs(&building_type).is_none() {
        return Err(format!("Unknown building type: {}", building_type));
    }

    let p = ctx
        .db
        .planet()
        .id()
        .find(&planet_id)
        .ok_or("Planet not found")?;

    if p.owner_id != Some(ctx.sender()) {
        return Err("You do not own this planet".to_string());
    }

    let active_jobs: Vec<_> = ctx
        .db
        .build_queue()
        .build_queue_planet_id()
        .filter(&planet_id)
        .collect();
    if !active_jobs.is_empty() {
        return Err("Build queue is busy".to_string());
    }

    let current_level = ctx
        .db
        .building()
        .building_planet_id()
        .filter(&planet_id)
        .find(|b| b.building_type == building_type)
        .map(|b| b.level)
        .unwrap_or(0);

    let target_level = current_level + 1;

    let (cost_iron, cost_plasma, cost_crystals) = building_cost(&building_type, target_level)?;

    if p.iron < cost_iron || p.plasma < cost_plasma || p.crystals < cost_crystals {
        return Err("Insufficient resources".to_string());
    }

    ctx.db.planet().id().update(Planet {
        iron: p.iron - cost_iron,
        plasma: p.plasma - cost_plasma,
        crystals: p.crystals - cost_crystals,
        ..p
    });

    let duration_us = build_time_us(&building_type, target_level)?;
    let finish_at = ctx.timestamp + std::time::Duration::from_micros(duration_us);

    ctx.db.build_queue().insert(BuildQueue {
        scheduled_id: 0,
        scheduled_at: finish_at.into(),
        planet_id,
        building_type,
        target_level,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_build(ctx: &ReducerContext, planet_id: u64) -> Result<(), String> {
    let p = ctx
        .db
        .planet()
        .id()
        .find(&planet_id)
        .ok_or("Planet not found")?;

    if p.owner_id != Some(ctx.sender()) {
        return Err("You do not own this planet".to_string());
    }

    let active_jobs: Vec<_> = ctx
        .db
        .build_queue()
        .build_queue_planet_id()
        .filter(&planet_id)
        .collect();
    if active_jobs.is_empty() {
        return Err("No active build job".to_string());
    }

    let job = active_jobs.into_iter().next().unwrap();
    let (cost_iron, cost_plasma, cost_crystals) =
        building_cost(&job.building_type, job.target_level)?;

    ctx.db.planet().id().update(Planet {
        iron: p.iron + cost_iron,
        plasma: p.plasma + cost_plasma,
        crystals: p.crystals + cost_crystals,
        ..p
    });

    ctx.db
        .build_queue()
        .scheduled_id()
        .delete(&job.scheduled_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn build_ship(ctx: &ReducerContext, planet_id: u64) -> Result<(), String> {
    let p = ctx
        .db
        .planet()
        .id()
        .find(&planet_id)
        .ok_or("Planet not found")?;

    if p.owner_id != Some(ctx.sender()) {
        return Err("You do not own this planet".to_string());
    }

    let shipyard = ctx
        .db
        .building()
        .building_planet_id()
        .filter(&planet_id)
        .find(|b| b.building_type == "shipyard")
        .ok_or("No Shipyard on this planet")?;

    if shipyard.level < 1 {
        return Err("Shipyard must be at least level 1".to_string());
    }

    if p.iron < EXPLORER_COST_IRON
        || p.plasma < EXPLORER_COST_PLASMA
        || p.crystals < EXPLORER_COST_CRYSTALS
    {
        return Err(format!(
            "Need ⚙️{} ⚡{} 💎{} to build an Explorer",
            EXPLORER_COST_IRON, EXPLORER_COST_PLASMA, EXPLORER_COST_CRYSTALS
        ));
    }

    ctx.db.planet().id().update(Planet {
        iron: p.iron - EXPLORER_COST_IRON,
        plasma: p.plasma - EXPLORER_COST_PLASMA,
        crystals: p.crystals - EXPLORER_COST_CRYSTALS,
        ..p
    });

    if let Some(fleet) = ctx.db.fleet().owner_id().find(&ctx.sender()) {
        ctx.db.fleet().owner_id().update(Fleet {
            explorer_count: fleet.explorer_count + 1,
            ..fleet
        });
    } else {
        ctx.db.fleet().insert(Fleet {
            owner_id: ctx.sender(),
            explorer_count: 1,
        });
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn send_fleet(
    ctx: &ReducerContext,
    source_planet_id: u64,
    target_planet_id: u64,
) -> Result<(), String> {
    let source = ctx
        .db
        .planet()
        .id()
        .find(&source_planet_id)
        .ok_or("Source planet not found")?;

    if source.owner_id != Some(ctx.sender()) {
        return Err("You do not own the source planet".to_string());
    }

    if ctx.db.planet().id().find(&target_planet_id).is_none() {
        return Err("Target planet not found".to_string());
    }

    if source_planet_id == target_planet_id {
        return Err("Source and target must be different planets".to_string());
    }

    let fleet = ctx
        .db
        .fleet()
        .owner_id()
        .find(&ctx.sender())
        .ok_or("You have no ships")?;

    let outbound_count = ctx
        .db
        .fleet_mission()
        .fleet_mission_owner()
        .filter(&ctx.sender())
        .count();

    let inbound_count = ctx
        .db
        .return_mission()
        .return_mission_owner()
        .filter(&ctx.sender())
        .count();

    let in_flight = outbound_count + inbound_count;

    if fleet.explorer_count as usize <= in_flight {
        return Err("No Explorers available — all are in flight".to_string());
    }

    let target = ctx
        .db
        .planet()
        .id()
        .find(&target_planet_id)
        .ok_or("Target planet not found")?;

    let now_secs = ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs_f64();

    let src_sys = ctx
        .db
        .solar_system()
        .id()
        .find(&source.system_id)
        .ok_or("Source system not found")?;
    let tgt_sys = ctx
        .db
        .solar_system()
        .id()
        .find(&target.system_id)
        .ok_or("Target system not found")?;

    let (sx, sy) = planet_world_pos(&source, &src_sys, now_secs);
    let (tx, ty) = planet_world_pos(&target, &tgt_sys, now_secs);
    let dist = ((tx - sx).powi(2) + (ty - sy).powi(2)).sqrt();

    let travel_us = (dist * TRAVEL_SPEED_US_PER_UNIT) as u64;
    let arrive_at = ctx.timestamp + std::time::Duration::from_micros(travel_us);

    ctx.db.fleet().owner_id().update(Fleet {
        explorer_count: fleet.explorer_count - 1,
        ..fleet
    });

    ctx.db.fleet_mission().insert(FleetMission {
        scheduled_id: 0,
        scheduled_at: arrive_at.into(),
        owner_id: ctx.sender(),
        source_planet_id,
        target_planet_id,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn set_planet_name(ctx: &ReducerContext, planet_id: u64, name: String) -> Result<(), String> {
    use rustrict::CensorStr;
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Name must not be empty".to_string());
    }
    if trimmed.len() > 32 {
        return Err("Name too long (max 32 characters)".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || c == ' ' || c == '-' || c == '\'')
    {
        return Err(
            "Name may only contain letters, numbers, spaces, hyphens and apostrophes".to_string(),
        );
    }
    if trimmed.is_inappropriate() {
        return Err("Name contains inappropriate content".to_string());
    }

    let p = ctx
        .db
        .planet()
        .id()
        .find(&planet_id)
        .ok_or("Planet not found")?;

    if p.owner_id != Some(ctx.sender()) {
        return Err("You do not own this planet".to_string());
    }

    ctx.db.planet().id().update(Planet {
        name: Some(trimmed),
        ..p
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn set_name(ctx: &ReducerContext, name: String) -> Result<(), String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Name must not be empty".to_string());
    }

    let p = ctx
        .db
        .player()
        .identity()
        .find(ctx.sender())
        .ok_or("Player not found")?;

    ctx.db.player().identity().update(Player {
        name: Some(trimmed),
        ..p
    });

    Ok(())
}

#[spacetimedb::reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    if let Some(existing) = ctx.db.player().identity().find(ctx.sender()) {
        ctx.db.player().identity().update(Player {
            online: true,
            ..existing
        });
        return;
    }

    let unowned: Vec<Planet> = ctx
        .db
        .planet()
        .iter()
        .filter(|p| p.owner_id.is_none())
        .collect();

    let assigned_planet_id = if !unowned.is_empty() {
        let now_micros = ctx
            .timestamp
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_micros() as u64;
        let idx = (now_micros % unowned.len() as u64) as usize;
        let chosen = unowned[idx].clone();
        let chosen_id = chosen.id;

        ctx.db.planet().id().update(Planet {
            owner_id: Some(ctx.sender()),
            ..chosen
        });

        ctx.db.building().insert(Building {
            id: 0,
            planet_id: chosen_id,
            building_type: "iron_mine".to_string(),
            level: 1,
        });

        Some(chosen_id)
    } else {
        None
    };

    ctx.db.player().insert(Player {
        identity: ctx.sender(),
        name: None,
        planet_id: assigned_planet_id,
        online: true,
    });
}

#[spacetimedb::reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    if let Some(p) = ctx.db.player().identity().find(ctx.sender()) {
        ctx.db
            .player()
            .identity()
            .update(Player { online: false, ..p });
    }
}

#[spacetimedb::reducer]
pub fn debug_give_resources(ctx: &ReducerContext) {
    if let Some(player) = ctx.db.player().identity().find(ctx.sender()) {
        if let Some(planet_id) = player.planet_id {
            if let Some(planet) = ctx.db.planet().id().find(planet_id) {
                ctx.db.planet().id().update(Planet {
                    iron: planet.iron + 5000.0,
                    plasma: planet.plasma + 5000.0,
                    crystals: planet.crystals + 5000.0,
                    ..planet
                });
            }
        }
    }
}
