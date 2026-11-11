import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AuthModal from "./shell/AuthModal";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {/* 登录浮层挂在根节点：首页、公开页（/b /p /t /c）都能原地唤起 */}
    <AuthModal />
  </React.StrictMode>,
);
