import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useLiveData } from "@/contexts/live-data";
import { useSite } from "@/contexts/site";

export function Header() {
  const { t } = useTranslation();
  const { settings, nodes } = useSite();
  const { status, error, updatedAt } = useLiveData();
  const location = useLocation();

  const latestObserved = Math.max(0, ...Object.values(status).map(item => item.bridge?.observed_at ?? Date.parse(item.time)).filter(Number.isFinite));
  const total = nodes.length;
  const online = nodes.reduce(
    (count, node) => count + (status[node.uuid]?.online ? 1 : 0),
    0,
  );

  const isIndex = location.pathname === "/";

  return (
    <header className="km-navbar">
      <div>
        {isIndex ? (
          <h1 className="km-navbar-title">
            {settings?.sitename || t("index.title")}
          </h1>
        ) : (
          <Link to="/" className="km-navbar-title km-navbar-home">
            {settings?.sitename || t("index.title")}
          </Link>
        )}
        {total > 0 ? (
          <p className="km-navbar-subtitle km-num">
            {t("index.onlineCount", { online, total })}
          </p>
        ) : null}
      </div>

      <div role="status" style={{ fontFamily: "system-ui", fontSize: 12, maxWidth: 420 }}>
        {error ? `Upstream unavailable: ${error.message}` : Object.values(status).some(item => item.bridge?.stale) ? "Data stale — server state unknown" : updatedAt ? `Snapshot observed ${new Date(latestObserved || updatedAt).toLocaleTimeString()}` : "Connecting…"}
        <div>— = missing / unsupported. No control or billing capabilities.</div>
      </div>
      <div className="km-navbar-actions">
<span className="km-ui-button">LeoBridge · Read only</span>
      </div>
    </header>
  );
}
