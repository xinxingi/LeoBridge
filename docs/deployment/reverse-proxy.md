# 单域名反向代理

默认single模式只需一个域名指向一个端口，例如：

```text
https://monitor.example.com → Caddy/nginx → 127.0.0.1:8787
```

`/`展示当前主题，`/admin/`是后台，`/?__preview=<安装ID>`预览指定主题。多页预览各自绑定版本，不切换正式主题；资源、API和WebSocket沿用同一域名，不需要泛域名DNS或证书。请整站转发，保留路径、查询参数和Referer，不额外缓存预览响应。

## 应用配置

Docker只需把Compose的BRIDGE_ORIGIN设为`https://monitor.example.com`并重建容器。运行包/源码使用相同站点地址，另设BRIDGE_ACCESS=public允许展示，保存到显式BRIDGE_ENV_FILE指定的私有文件后重启。地址不含/admin/或末尾/。

应用仍监听HTTP 8787；默认不要求proxy、可信代理IP、独立管理域名或预览域名。BRIDGE_ORIGIN只用于规范站点地址、链接及Cookie协议，不能配置证书；TLS和HTTP跳转HTTPS由代理完成。必须保留原Host，不能改成上游127.0.0.1，也不能只用X-Forwarded-Host传域名。

默认不采信转发协议/IP头，管理登录按实际socket来源限流，同一代理的访客共享来源。确需使用真实客户端IP时才启用[高级proxy](../configuration.md#node运行参数)，配置严格的来源白名单。已有proxy配置仍兼容。

## Caddy

DNS指向部署服务器，并满足Caddy签发证书的条件。在自己的Caddyfile中添加：

```caddyfile
monitor.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy处理HTTPS，HTTP上游默认保留Host并支持WebSocket。默认模式不使用转发头；若选择高级proxy，再配置`header_up X-Real-IP {remote_host}`及对应可信来源。这里假设Caddy直接接收客户端连接；前面还有CDN或其他代理时须另外确认真实客户端IP信任链。代理在另一容器时，目标地址应换为共享网络中可达的应用地址，不能使用代理容器自身的127.0.0.1。

配置变更后，若使用默认`/etc/caddy/Caddyfile`和systemd服务：

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# 上一步通过后执行
sudo systemctl reload caddy
```

容器运行的Caddy应在对应容器内用实际路径执行`caddy validate`和`caddy reload`。仅重建LeoBridge容器且上游地址不变时无需重载Caddy；修改Caddyfile则需要。Caddy默认保留Host及处理WebSocket，不能把Host改成127.0.0.1，也不能仅靠X-Forwarded-Host传递域名。

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

修改nginx配置后先`sudo nginx -t`，通过后`sudo systemctl reload nginx`（按实际服务管理方式调整）。

不要把`proxy_pass`改为丢弃原路径和参数的重写，也不要清除同源Referer或设置全站`Referrer-Policy: no-referrer`。原主题的根路径资源和模块依赖需要同源Referer来补齐预览版本；应用不会向跨域地址发送此Referer。

## 可选的独立源隔离

同域名不同路径或查询参数不构成安全隔离，只预览和启用可信主题。需要独立源隔离时显式改用`BRIDGE_ROUTING=isolated`，另配`BRIDGE_ADMIN_ORIGIN`、`BRIDGE_DISPLAY_DOMAIN`和`BRIDGE_PREVIEW_ORIGIN`，为展示根、管理源、版本及预览子域配置DNS、HTTPS和反代。Node的HTTPS多源隔离需同时启用高级`BRIDGE_NODE_MODE=proxy`并配置可信代理及转发头。应用仍可共用一个监听端口；额外域名仅用于这种可选模式。

## 验证

配置后检查后台登录、两个主题同时预览、详情刷新、历史和WSS，再检查正式首页未切换。首页HTTP 200不足以证明预览和实时可用；单元测试及本地模拟代理不能代替实际Caddy/nginx与公网TLS验收。
