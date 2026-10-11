import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { ModelServiceEditor } from "@/pages/settings/model-service-editor";

createRoot(document.getElementById("root")!).render(
    <ConfigProvider><App><ModelServiceEditor capability="video" onClose={() => {}} onSave={async channel => {
        Object.assign(window, { savedChannel: channel });
    }} /></App></ConfigProvider>,
);
