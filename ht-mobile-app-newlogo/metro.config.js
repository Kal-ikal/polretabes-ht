const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => {
    return (req, res, next) => {
      // Metro hardcodes /assets as static asset requests.
      // If web browser navigates to or refreshes the "/assets" page route,
      // bypass Metro asset handler and delegate to Expo Router's web HTML handler.
      const url = req.url || "";
      if (url === "/assets" || url.startsWith("/assets?")) {
        const accept = req.headers["accept"] || "";
        if (accept.includes("text/html") || accept.includes("*/*")) {
          return next();
        }
      }
      return metroMiddleware(req, res, next);
    };
  },
};

module.exports = withNativeWind(config, { input: "./global.css" });
