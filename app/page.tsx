export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 640 }}>
      <h1>FlowStack backend</h1>
      <p>Backend 1.0 in dev mode. The UI comes later; see <code>/api/health</code>.</p>
      <p><a href="/api/auth/xero/start">Connect Xero</a></p>
    </main>
  );
}
