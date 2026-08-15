# e-Mate Auth Gateway

独立的企业认证入口，精确实现桌面端现有的两个协议：

- `POST /v1/auth/password`：`clientId`、`organization`、`user`、`password`
- `POST /v1/auth/refresh`：`clientId`、`refreshToken`、`refreshRequestId`

成功响应为 `schemaVersion: 1` 的 `EnterpriseAuthSession`。其中
`modelGateway.sessionToken` 是 Ed25519 签名的 Model Gateway 会话 JWT，包含
`models:read`、`responses:create`、`usage:read`，可直接访问包括
`/v1/consents/current` 在内的受保护接口。

## 生产边界

- 密码只以固定参数 scrypt（N=65536、r=8、p=1、32 字节随机盐）保存。
- 刷新令牌只保存 SHA-256 hash。轮换使用数据库行锁；同一
  `refreshRequestId` 重试返回同一替代令牌，旧令牌以其他 request ID 重放时吊销整个会话。
- 组织名只来自生产配置中的显式 `organization -> tenant` 映射。
- 登录与刷新都会校验现有 `e_mate_tenant_user` 为 `ACTIVE`、角色合法，并按
  `e_mate_tenant_model_route` 计算当时启用的模型。Model Gateway 仍会在每次请求时复核，管理员停用用户或模型可即时生效。
- 可签发模型 ID 只从只读挂载的同一份 `model-gateway-config.json` 的
  `routes[].id` 读取；目录缺失、为空、重复或含本地伪模型时启动失败，Auth 不维护第二份易漂移的生产模型列表。
- 未配置 IdP 和邮件提供商，因此 SSO 与密码重置明确返回
  `FEATURE_UNAVAILABLE`，没有伪实现。
- 不提供默认账号、默认密码或管理端密码设置接口。密码凭据表必须由后续受审计的管理员流程或离线开通流程写入；可复用本包导出的
  `derivePasswordVerifier`，但不得直接拼 SQL 处理明文密码。

## 配置与启动

唯一环境变量是配置文件位置，密钥不放环境变量或 JSON：

```bash
E_MATE_AUTH_GATEWAY_CONFIG_FILE=/etc/e-mate/auth-gateway.production.json \
  node apps/auth-gateway/dist/start.js
```

参见 `production.config.example.json`。数据库 URL、TLS 私钥、会话 Ed25519
私钥与 32 字节 base64url 刷新派生密钥都通过独立文件注入；POSIX 系统只允许所有者或受控运行组读取秘密文件。`database.transport.mode=internal-plaintext`
仅允许精确 Docker 内网主机 `postgres`；任何其他数据库地址都必须使用
`verify-ca` 并提供受信 CA，不能通过 URL 参数关闭校验。

会话签名公钥必须同步配置到 Model Gateway 的 session keyring，`issuer`、
`audience`、`kid` 必须完全一致。usage 公钥必须对应 Usage Ledger 当前签名私钥。

## 数据库留痕

启动时只创建认证自有表：

- `e_mate_auth_password_credential`
- `e_mate_auth_session`
- `e_mate_auth_refresh_token`

三张表均外键关联现有 `e_mate_tenant_user`。如果租户用户表或模型策略表不存在，启动直接失败，不自动创建伪用户或降级到本地身份。

开发记录（2026-08-02）：本切片只新增 `apps/auth-gateway`，未修改桌面端、管理员后台、分析看板或 Model Gateway；管理员凭据设置与 IdP 集成留待独立审计切片。
