const path = require("path");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

module.exports = ["source-map"].map((devtool) => ({
  mode: "development",
  entry: "./mqtt.js",
  plugins: [
    new CleanWebpackPlugin(), // removes previous build folder(s) before building
  ],
  output: {
    filename: "mqtt.js",
    path: path.resolve(__dirname, "dist"),
    library: "mqtt",
    libraryTarget: "umd",
  },
}));
