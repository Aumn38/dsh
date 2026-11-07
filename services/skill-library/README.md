# skill-library 服务

给 DSH 的两个客户端插件（Skill 库、插件库）提供数据的本机 HTTP 服务。

## 服务什么

- `GET /api/skills` — 各 Agent 的 skill 列表（全局 / code / life / memory），实时读
  `/opt/localagent/dsh-workspace/` 下的 skill 目录。
- `GET /api/plugins` — 插件列表（官方内置 9 个 + 后装的），带启用状态（`enabled`）、
  是否可管理（`manageable`）与自带图标（`icon_svg`，有就返回原图 data URI）。
- `POST /api/plugins/action` — 启用 / 停用 / 删除一个插件。
  Body：`{"action": "enable" | "disable" | "remove", "name": "<插件名>"}`。
  只接受当前列表里 `manageable` 的插件名；`@deepseek-ai/*` 与带路径的名字一律拒绝。
  - enable：已装进 web profile 的只改 `package.json` 的 `bundles`；只有源码目录的走
    `dsh plugin add file:` 装上。
  - disable：只把名字从 web profile 的 `bundles` 里拿掉，文件与依赖都保留，可再启用。
  - remove：`dsh plugin remove`（从依赖 + bundles + node_modules 里移除），
    `/opt/localagent/dsh-plugins/` 下的源码目录保留，可重新启用。
  - 改完都要重开 DSH 应用才生效（没有热重载）。

## 运行

监听 `0.0.0.0:8899`（本机与 tailnet 都能访问），用 Python 标准库 `http.server`，无第三方依赖。
skill 与插件文件属于 `localagent` 用户，服务以 `peter` 身份跑，读文件时经 `sudo -A`
（`SUDO_ASKPASS=/tmp/.askpass.sh`）提权；写配置与装删插件时同样经 sudo（root 写
`package.json`，localagent 跑 `dsh plugin`）。

```bash
SUDO_ASKPASS=/tmp/.askpass.sh nohup python3 /home/peter/skill-library/skill-library.py \
  >/home/peter/skill-library/server.log 2>&1 &
```

不是 systemd 服务，直接跑；重启 = 杀掉进程再按上面起一次。健康检查：

```bash
curl -s http://127.0.0.1:8899/api/plugins | head -c 200
```

## 注意

- 官方内置插件与只在 SDK 里跑的插件（记忆宫殿、上下文、循环守卫等）不可在此管理，
  改 SDK 会影响三个 Agent 的运行环境。
- 服务本身不存任何凭证；它只读文件、改配置，密钥始终只在
  `/opt/localagent/config/agent.env` 里。
