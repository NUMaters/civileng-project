import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { App } from "./app/App";
import "./styles/global.css";

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement === null) {
  throw new Error("React root element was not found");
}

createRoot(rootElement).render(createElement(StrictMode, null, createElement(App)));
