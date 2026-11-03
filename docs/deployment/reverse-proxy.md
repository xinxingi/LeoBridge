# 单域名反向代理

默认single模式只需一个域名指向一个端口，例如：

```text
https://monitor.example.com → Caddy/nginx → 127.0.0.1:8787
```

`/`展示当前主题，`/admin/`是后台，`/?__preview=<安装ID>`预览指定主题。多页预览各自绑定版本，不切换正式主题；资源、API和WebSocket沿用同一域名，不需要泛域名DNS或证书。请整站转发，保留路径、查询参数和Referer，不额外缓存预览响应。

## 应用配置

Docker在Compose的`.env`中配置后重建容器；运行包使用显式`BRIDGE_ENV_FILE`指定私有配置文件，修改后重启。proxy模式不自动读取开发`.dev.vars`。示例域名换为自己的实际域名：

```dotenv
BRIDGE_ROUTING=single
BRIDGE_NODE_MODE=proxy
BRIDGE_ORIGIN=https://monitor.example.com
BRIDGE_LISTEN_PORT=8787
BRIDGE_ACCESS=public
BRIDGE_TRUSTED_PROXIES=127.0.0.1/32,::1/128
```

这些是反代对接参数，管理密码、状态目录等沿用原部署配置。`public`表示展示无需额外密码，后台仍需登录；展示密码见[配置参考](../configuration.md)。非容器应用默认监听127.0.0.1。Docker继续使用Compose的容器监听和回环端口映射；其实际代理来源可能是Docker网关，须把`BRIDGE_TRUSTED_PROXIES`改为应用实际看到的代理IP/CIDR，不要直接复制回环地址或放开全部网段。

## Caddy

DNS指向部署服务器，并满足Caddy签发证书的条件。在自己的Caddyfile中添加：

```caddyfile
monitor.example.com {
    reverse_proxy 127.0.0.1:8787 {
        header_up X-Real-IP {remote_host}
        header_up -Forwarded
        header_up -X-Forwarded-Host
        header_up -CF-Connecting-IP
    }
}
```

Caddy处理HTTPS，HTTP上游默认保留Host，传递X-Forwarded-Proto并支持WebSocket。这里假设Caddy直接接收客户端连接；前面还有CDN或其他代理时须另外确认真实客户端IP信任链。代理在另一容器时，目标地址应换为共享网络中可达的应用地址，不能使用代理容器自身的127.0.0.1。

## nginx

在`http`块中定义一次WebSocket连接变量：

```nginx
map $http_upgrade $bridge_connection {
    default upgrade;
    ''      close;
}
```

在已有的`monitor.example.com` HTTPS `server`块中配置以下location；该server的443监听、证书及续期沿用自己的配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $bridge_connection;
    proxy_set_header Forwarded "";
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header CF-Connecting-IP "";
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    proxy_cache off;
}
```

不要把`proxy_pass`改为丢弃原路径和参数的重写，也不要清除同源Referer或设置全站`Referrer-Policy: no-referrer`。原主题的根路径资源和模块依赖需要同源Referer来补齐预览版本；应用不会向跨域地址发送此Referer。

## 可选的独立源隔离

同域名不同路径或查询参数不构成安全隔离，只预览和启用可信主题。需要独立源隔离时显式改用`BRIDGE_ROUTING=isolated`，另配`BRIDGE_ADMIN_ORIGIN`、`BRIDGE_DISPLAY_DOMAIN`和`BRIDGE_PREVIEW_ORIGIN`，为展示根、管理源、版本及预览子域配置DNS、HTTPS和反代。应用仍可共用一个监听端口；额外域名仅用于这种可选模式。

## 验证

配置后检查后台登录、两个主题同时预览、详情刷新、历史和WSS，再检查正式首页未切换。首页HTTP 200不足以证明预览和实时可用；单元测试及本地模拟代理不能代替实际Caddy/nginx与公网TLS验收。
