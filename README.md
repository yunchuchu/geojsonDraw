# GeoJSON Draw Tool

基于 `Vue 3 + Leaflet` 的高德底图 GeoJSON 手动绘制工具，支持点/面绘制、编辑、删除和导出。

## 配置高德 Key

1. 复制配置模板：
   - `cp .env.example .env`
2. 在 `.env` 中填写你的高德 Web Key：
   - `VITE_AMAP_KEY=你的高德Web端Key`
3. 启动项目：
   - `npm install`
   - `npm run dev`

如果页面提示“未检测到 VITE_AMAP_KEY”或“高德底图加载失败”，请检查 Key 是否正确、域名白名单是否包含当前访问地址（如 `localhost`、`127.0.0.1`）。
