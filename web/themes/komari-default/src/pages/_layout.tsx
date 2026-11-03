import { LiveDataProvider, useLiveData } from "@/contexts/LiveDataContext";
import Footer from "../components/Footer";
import NavBar from "../components/NavBar";
import { Outlet } from "react-router-dom";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { useIsMobile } from "@/hooks/use-mobile";

const IndexLayout = () => {
  // 使用我们的LiveDataContext
  const InnerLayout = () => {
    const { showCallout } = useLiveData();
    const { publicInfo } = usePublicInfo();
    const isMobile = useIsMobile();
    const bgUrlDesktop = publicInfo?.theme_settings?.backgroundImageUrlDesktop;
    const bgUrlMobile = publicInfo?.theme_settings?.backgroundImageUrlMobile;
    const bgUrl = isMobile ? bgUrlMobile || bgUrlDesktop : bgUrlDesktop;
    const mainContentWidth =
      publicInfo?.theme_settings?.mainContentWidth ?? 100;
    return (
      <>
        <div
          className={
            bgUrl
              ? "km-layout layout flex flex-col w-full min-h-screen bg-cover bg-center bg-fixed bg-no-repeat"
              : "km-layout layout flex flex-col w-full min-h-screen bg-accent-1"
          }
          style={{
            backgroundImage: bgUrl ? `url(${bgUrl})` : "none",
          }}
        >
          <main
            className="km-main main-content m-1 h-full"
            style={{
              width: `${mainContentWidth}vw`,
              maxWidth: "100%",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <NavBar />
            <p role="status" className="mx-4 my-2 text-sm text-gray-500">{showCallout ? "妙妙屋X实时数据 · 缺失指标显示 — · 历史使用源端原始采样桶" : "数据暂不可用或已过期，正在重试；不代表服务器离线。"}</p>
            <Outlet />
          </main>
          <Footer />
        </div>
      </>
    );
  };

  return (
    <LiveDataProvider>
      <InnerLayout />
    </LiveDataProvider>
  );
};

export default IndexLayout;
