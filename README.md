# Anthony 作品集

纯静态网站，可部署在 GitHub Pages。没有构建步骤，也不需要另外租服务器。

## 日常使用

- 首页右上角「编辑」：直接点击名称和介绍修改；点击视频封面或「安装包」展开对应设置。
- 「新建」：新增一张作品卡片。「删除」：移除当前作品，并提供撤销。
- 「外观」可切换排版和主色；「完成」保存当前浏览器的草稿。
- 尚未填完的链接也会保留为本机编辑草稿；发布前需补全。
- 「发布」：连接 GitHub 后提交修改；Pages 部署完成，访客会看到新版本。
- 底部作品名称用于切换作品。草稿标记可返回已发布版本。
- admin.html 保留完整管理台，用于站点信息和其他视频记录。

介绍文字支持分段、`**粗体**`、`## 小标题`和 `- 列表`。排版可选「左右布局」或「居中布局」。

## 视频与安装包

视频填完整 B 站视频链接或 BV 号；不支持 b23.tv 短链接，先打开短链接并复制完整地址。点击封面后加载 B 站播放器，播放是否可用取决于视频公开性、嵌入许可和平台限制；播放器下方保留原站入口。

安装包可以粘贴现成下载链接，也可以连接 GitHub 后从网页直接选择文件。此版本直接上传限制为 **48 MiB**，文件存入 downloads/ 下独立目录，保留旧文件。上传文件本身会立即提交到仓库；还需发布内容才能加入网站下载列表。更大的文件请在 GitHub Releases 上传后粘贴下载地址。

## 首次部署

1. 将本目录的 index.html、admin.html、404.html、.nojekyll、robots.txt、assets/、content/、downloads/ 上传到仓库根目录。不要把整个网站套在额外一层文件夹中。
2. 仓库 Settings → Pages → Deploy from a branch → main → / (root)。
3. 等待 Pages 的部署成功后打开给出的地址。
4. 网站「编辑」→「GitHub」，填写仓库用户名、仓库名、分支和 Token。

Token 使用 GitHub 的 fine-grained personal access token，只选目标仓库，授予 Contents: Read and write，并设置到期时间。Token 不写入代码或内容文件，只在当前标签页会话中使用。不同标签页可能需要重新连接。请勿把 Token 发到聊天或提交到仓库。

已有仓库替换前请保留历史和自定义域名 CNAME，Releases 的安装包无需重新上传。若仓库已存在不同的 content/site.json，先在完整管理台读取最新内容，避免覆盖。发布遇到冲突时先导出草稿，再读取最新仓库版本。

GitHub Pages 是静态托管；真正的线上修改由浏览器调用 GitHub API 完成。预览和导出不会自动部署，提交成功也不代表 Pages 部署已完成。

## 本地打开

桌面「Anthony 作品集」快捷方式继续可用。也可在本目录运行 `python -m http.server 8765 --bind 127.0.0.1` 后打开 http://127.0.0.1:8765/ 。不要直接双击 index.html（浏览器会限制读取 JSON）。

官方参考：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)、[内容 API](https://docs.github.com/en/rest/repos/contents)。
