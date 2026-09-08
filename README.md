# RHINE LAB · ANALYSIS OS

以工作目录中《明日方舟》特别映像「莱茵生命：访问」5–40 秒为参考的实时三维交互终端。

## 运行

```powershell
npm install
npm run dev
```

打开终端打印的本地地址。默认端口为 5173；本次预览使用 <http://127.0.0.1:5173/>。

也可以双击 `启动终端.cmd`。构建生产版本使用 `npm run build`，预览生产版本使用 `npm run preview`。

## 使用

- 默认播放约 35 秒的接入、身份验证、圆环扫描、欢迎、档案阵列展开与抽取镜头。
- 点击右上角 **ENTER SYSTEM** 或按 Enter / Esc，直接进入档案阵列。
- 点击三维档案、下方刻度或左右按钮选择档案；左右方向键也可以切换。
- 点击 **ACCESS FILE** / 文件编号，或选择刻度后按 Enter，读取档案。
- 在详情左侧拖动，可以转动档案盒。Esc 返回阵列。
- `/` 打开检索；支持编号、标题、英文名称、科室和负责人，以及分类筛选。
- 收藏与音效、减少动效、画质设置保存在当前浏览器的 localStorage。
- **EXPORT** 链接对应实际的 UTF-8 文本文件，位于 `public/archives/`。
- **REINITIALIZE** 重播完整启动过程；已开启减少动效时会直接重新进入阵列。

## 工程

技术栈为 TypeScript + Three.js + Vite，没有使用前端或动效 Skill。Three.js 负责实时模型、实例化、环境光、阴影、景深与镜头；原生 DOM / CSS / SVG 负责字体、界面与标志。视频只用于观察与关键帧对照，运行时没有引用或播放视频。

布局基准是 **1920×1080**，窗口按比例缩放并保留构图，主要面向桌面与横向大屏。文字采用设备上的 Arial / Helvetica 与 Microsoft YaHei 后备字体，没有打包字体文件。

文件说明：

| 文件 | 用途 |
| --- | --- |
| `src/main.ts` | 启动时间轴、状态切换、检索、收藏、设置与键盘交互 |
| `src/scene.ts` | 三维阵列、实例化、材质、镜头、射线拾取与景深 |
| `src/motion.ts` | 波峰传播、两段抽取、点击涟漪与临界阻尼运动 |
| `src/style.css` | 1920×1080 界面定位、排版及过渡 |
| `src/data.ts` | 12 份可检索档案的内容 |
| `src/audio.ts` | 可选的程序化界面提示音 |
| `public/assets/archive-cassette.glb` | Blender MCP 制作并导出的档案盒模型 |
| `art/rhine-archive.blend` | Blender 源文件，包含模型及审阅灯光、相机 |
| `art/build_archive.py` | 通过 Blender MCP 执行的可复现建模与导出脚本 |
| `art/setup_studio.py` | Blender 资产审阅灯光和相机配置 |
| `art/archive-studio.png` | Blender Cycles 资产审阅图 |
| `scripts/export-records.mjs` | 从同一档案数据生成可下载文本，开发和构建前自动运行 |
| `DESIGN.md` | 视觉参考和设计记录 |
| `verification/REPORT.md` | 验证记录与已知范围 |
| `reference/review.html` | 同步原视频与实时场景，支持逐帧步进，仅开发环境使用 |
| `reference/wave-compare.html` | 同步对比循环阵列基线与去除负向波谷后的版本，含慢放、逐帧、最大差异定位和实际高度曲线，仅开发环境使用 |
| `scripts/check-motion.mjs` | 波峰传播方向、25fps 连续性、抽取停留及帧率独立检查 |

## Blender 资产

模型通过本机 Blender MCP 创建，而后导出 GLB。包含聚合物外壳、内层散射板、双圆盘、金属螺钉、香槟色索引片、印字与模压刻线。原片时间轴使用 **160 个位置**；交互阵列使用固定的 **288 个循环位置**，支持上下与左右持续循环。抽出的档案使用完整细节与物理透射材质，实时编号标签随选中文件更新。

重新建模时，在 Blender MCP 中执行 `art/build_archive.py`，再执行 `art/setup_studio.py`。脚本中的 `ROOT` 使用当前项目绝对路径；移动项目后需调整。

## 复核入口

以下入口使用同一套实时场景，方便复核时间轴：

- `/reference/review.html`：原片与实时场景并排对照，可播放或逐帧步进。
- `/?time=21.8`：直接从阵列进入前开始播放，方便检查波纹与抽取。

- `/?scene=archive`：档案阵列。
- `/?scene=detail`：档案详情。
- `/?time=8&freeze=1`：认证界面，对应原片约 13 秒。
- `/?time=16&freeze=1`：权限扫描，对应原片约 21 秒。
- `/?time=20&freeze=1`：欢迎界面，对应原片约 25 秒。
- `/?time=28&freeze=1`：档案抽取，对应原片约 33 秒。
- `/?time=34&freeze=1`：档案特写，对应原片约 39 秒。

运动检查使用 `node scripts/check-motion.mjs`（Node 24）。

循环逻辑检查使用 `node scripts/check-loop.mjs`；`/reference/loop-review.html` 运行实际场景的循环、归位、坐标重置和原片时间轴回归检查。

## 内容与范围

这是本地交互终端复刻。JOYCE MOORE 的认证流程是演示状态机，并没有连接真实身份、权限或业务服务。视频未展示的研究摘要、日期、项目记录和交互内容为扩展演示数据，不应当作官方设定或真实研究资料。

已按参考校准构图、字号、字距与主要动画阶段。三维资产为重新建模，实时折射、景深和光照与原片离线渲染仍存在差异；没有用图像差分证明逐像素一致。

项目的 Three.js 引擎使生产 JavaScript 包约为 670 KB（gzip 约 176 KB）。首次加载还包括约 1.3 MB 的 GLB，后续运行不依赖网络资源。构建中的包体积提示属于这一已知成本。


当前界面已嵌入小米官方 MiSans 原版 WOFF2（四个字重合计约 19.7 MB，按实际使用加载）。许可与版权位于 public/fonts，设置页提供字体署名与许可入口。未对字体进行转换或子集化。
