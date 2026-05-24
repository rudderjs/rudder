export { config as default };

import type { Config } from "vike/types";
import vikeRscPlugin from "./plugin";

//@ts-expect-error
const config: Config = {
  name: "vike-react-rsc-rudder",
  require: {
    vike: ">=0.4.182",
  },
  // https://vike.dev/onRenderHtml
  onRenderHtml:
    "import:vike-react-rsc-rudder/__internal/integration/onRenderHtml:onRenderHtml",
  // https://vike.dev/onRenderClient
  onRenderClient:
    "import:vike-react-rsc-rudder/__internal/integration/onRenderClient:onRenderClient",

  onBeforeRender:
    "import:vike-react-rsc-rudder/__internal/integration/onBeforeRender:onBeforeRender",

  onPageTransitionStart:
    "import:vike-react-rsc-rudder/__internal/integration/onPageTransitionStart:onPageTransitionStart",

  // RudderJS fork change: vike >=0.4.257 requires config import strings to
  // name the export (`:default`); the upstream 1.0.0 (built against 0.4.246)
  // omitted it, which crashes vike's dev optimizeDeps. See README.
  client: "import:vike-react-rsc-rudder/__internal/integration/client:default",

  //@ts-expect-error
  middleware: "import:vike-react-rsc-rudder/__internal/integration/rscMiddleware:default",

  passToClient: ["rscPayloadString"],

  // https://vike.dev/clientRouting
  clientRouting: true,
  hydrationCanBeAborted: true,

  // https://vike.dev/meta
  meta: {
    rsc: {
      env: {
        server: true,
        client: false,
      },
    },
    onBeforeRender: {
      env: {
        server: true,
        client: false,
      },
    },
    Head: {
      env: { server: true },
      cumulative: true,
    },
    Wrapper: {
      env: { client: true, server: true },
      cumulative: true,
    },
    Layout: {
      env: { server: true, client: true },
      cumulative: true,
    },
    Loading: {
      env: { server: true, client: true },
    },
  },
  vite6BuilderApp: true,
  vite: {
    plugins: [vikeRscPlugin()],
  },
} satisfies Config;

import "./types/Config.js";
