import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { Identity } from "spacetimedb";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { DbConnection, ErrorContext } from "./module_bindings/index.ts";
import { AuthProvider, useAuth } from "react-oidc-context";

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? "ws://localhost:3000";
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? "browsergame";
const CLIENT_ID = import.meta.env.VITE_SPACETIMEAUTH_CLIENT_ID as string | undefined;
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

const oidcConfig = CLIENT_ID
  ? {
      authority: "https://auth.spacetimedb.com/oidc",
      client_id: CLIENT_ID,
      redirect_uri: `${window.location.origin}/`,
      post_logout_redirect_uri: window.location.origin,
      scope: "openid profile email",
      response_type: "code",
      automaticSilentRenew: true,
    }
  : null;

function onSigninCallback() {
  window.history.replaceState({}, document.title, window.location.pathname);
}

function SpacetimeWrapperWithAuth() {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#aaa",
          fontFamily: "monospace",
        }}
      >
        Authenticating…
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: "1.5rem",
          fontFamily: "monospace",
          background: "#0e0e1a",
          color: "#e0e0e0",
        }}
      >
        <div style={{ fontSize: "2rem" }}>🚀 Space Colony</div>
        <div style={{ color: "#888", fontSize: "0.9rem" }}>Sign in to play</div>
        <button
          onClick={() => auth.signinRedirect()}
          style={{
            background: "#1a3a5a",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 28px",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Sign In
        </button>
      </div>
    );
  }

  const token = auth.user?.access_token ?? localStorage.getItem(TOKEN_KEY) ?? undefined;

  const connectionBuilder = DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .onConnect((conn: DbConnection, identity: Identity, newToken: string) => {
      if (!auth.user) localStorage.setItem(TOKEN_KEY, newToken);
      console.log("Connected to SpacetimeDB with identity:", identity.toHexString());
      conn.subscriptionBuilder().subscribeToAllTables();
    })
    .onDisconnect(() => console.log("Disconnected from SpacetimeDB"))
    .onConnectError((_ctx: ErrorContext, err: Error) =>
      console.error("Error connecting to SpacetimeDB:", err),
    );

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App oidcAuth={auth} />
    </SpacetimeDBProvider>
  );
}

function SpacetimeWrapperNoAuth() {
  const token = localStorage.getItem(TOKEN_KEY) ?? undefined;

  const connectionBuilder = DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .onConnect((conn: DbConnection, identity: Identity, newToken: string) => {
      localStorage.setItem(TOKEN_KEY, newToken);
      console.log("Connected to SpacetimeDB with identity:", identity.toHexString());
      conn.subscriptionBuilder().subscribeToAllTables();
    })
    .onDisconnect(() => console.log("Disconnected from SpacetimeDB"))
    .onConnectError((_ctx: ErrorContext, err: Error) =>
      console.error("Error connecting to SpacetimeDB:", err),
    );

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App oidcAuth={null} />
    </SpacetimeDBProvider>
  );
}

const root = createRoot(document.getElementById("root")!);

if (oidcConfig) {
  root.render(
    <StrictMode>
      <AuthProvider {...oidcConfig} onSigninCallback={onSigninCallback}>
        <SpacetimeWrapperWithAuth />
      </AuthProvider>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <SpacetimeWrapperNoAuth />
    </StrictMode>,
  );
}
