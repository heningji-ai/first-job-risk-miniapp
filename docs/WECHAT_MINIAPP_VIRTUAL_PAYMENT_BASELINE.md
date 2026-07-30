# 微信小程序虚拟支付接入与现网验收基线

> 状态：Android / iOS 现网功能闭环已验收。本文冻结 Goal Fit「完整报告」虚拟支付的已验证行为，不替代微信平台规则、密钥管理或生产运维审计。

## 1. 商品与环境关系

| 层级 | 用途 | `env` | AppKey | 订单要求 |
| --- | --- | --- | --- | --- |
| 沙箱 | 接口联调和自动化测试 | `1` | sandbox AppKey | 不代表真实扣款或线上订单 |
| 开发道具 | 微信后台开发/测试配置 | 以微信后台实际配置为准 | 对应环境 AppKey | 仅用于验证调用链，不作为线上验收依据 |
| 线上道具 | 已发布的 `goal_fit_full_report` | `0` | production AppKey | 用于正式虚拟支付 |
| 真实支付 | Android 或 iOS 微信客户端 | `0` | production AppKey | 每次新支付尝试必须对应新的 provider order |

不得将沙箱签名、沙箱 AppKey、历史 `signData` 或历史 provider order 用于线上支付。价格由服务端商品规则冻结为 `1990` 分（¥19.9），前端不得传入或自行计算价格。

## 2. Android 与 iOS

- Android 与 iOS 使用同一 `wx.requestVirtualPayment` 协议、同一线上道具和同一服务端确认链路。
- 前端不得按 Android/iOS 选择支付通道、改写签名参数或使用 Apple SDK/receipt。
- 两端必须分别进行真实付款验收：付款页可打开、付款可完成、服务端确认成功、完整报告可读取。
- 开发者工具不作为真实付款凭证；不支持能力时展示中性提示，不引导其他平台或站外支付。

## 3. 配置冻结规则

生产配置只在服务端环境中保存，绝不进入前端构建产物、日志或仓库：

- `WECHAT_MINIAPP_VIRTUAL_PAYMENT_ENV=0`
- `WECHAT_MINIAPP_VIRTUAL_PAYMENT_APP_KEY_PROD`：仅用于生产签名
- `WECHAT_MINIAPP_APP_ID`：小程序 AppID
- `WECHAT_MINIAPP_VIRTUAL_PAYMENT_OFFER_ID`：微信后台 offerId
- `goal_fit_full_report`：冻结 productId
- `1990` 分：冻结商品金额

服务端启动应校验 env 与对应 AppKey 是否存在。AppKey 只允许以存在性或 SHA-256 短指纹进行运维审计，禁止输出原文。

## 4. 前端调用合同

前端先调用：

`POST /api/miniapp/goal-fit/assessments/:assessmentId/virtual-payment-params`

服务端返回的 `mode`、`signData`、`paySig`、`signature` 必须来自同一次 prepare 响应。前端原样调用：

```ts
wx.requestVirtualPayment({ mode, signData, paySig, signature, success, fail, complete })
```

禁止解析、JSON 序列化、持久化或打印 `signData`；禁止记录/上传 `paySig`、`signature`、AppKey、session key、openid 原文、完整 provider order。

支付组件回调不等于权益发放。成功、失败、取消、同步异常和 20 秒超时均必须退出可见的支付中状态；超时不得自动确认成功或读取完整报告。

## 5. 服务端闭环

1. `orders`：逻辑购买订单，绑定 identity、assessment、snapshot、商品用途、金额和状态。
2. `miniapp_virtual_payment_attempts`：一次 provider 调用；新 `requestId` 生成新的唯一 `provider_out_trade_no`。
3. prepare：以服务端环境、金额和 session key 生成签名参数。
4. confirm：通过 `paymentAttemptId` 查询微信 `xpay/query_order`，而非相信前端回调。
5. 已支付的可信微信结果经金额、env、order、identity、snapshot 校验后，原子更新 attempt/order 为 `paid` 并创建 active entitlement。
6. `GET full-report` 仅在 active entitlement 存在时读取报告。
7. `POST /api/miniapp/wechat/message-push` 是微信发货推送入口：验签、AES 解密、校验商品/金额/identity、反查微信订单、幂等 fulfill，成功返回 `success`。

## 6. 幂等与重复收费防护

- 相同 `(order_id, request_id)` 复用同一 attempt；新的支付重试必须生成新的 requestId。
- `provider_out_trade_no` 全局唯一，不能复用沙箱或历史支付签名。
- 前端 controller 对同一 assessment 的活跃支付流程复用 Promise，避免双击并发 prepare。
- 服务端 active entitlement 按 identity + assessment 幂等；重复 confirm、重复发货推送不会生成重复权益。
- 已购用户重新进入通过 purchases/full-report 恢复；已购状态不再显示可付款入口，也不创建新支付 attempt。

## 7. 安全诊断日志

前端基线 `934f3d1` 保留以下诊断事件：

- `payment_prepare_started` / `payment_prepare_succeeded`
- `virtual_payment_invoking`
- `virtual_payment_success` / `virtual_payment_fail` / `virtual_payment_complete`
- `virtual_payment_sync_throw` / `virtual_payment_timeout`

回调白名单只允许：`callbackPhase`、时间、`errCode`、`errno`、安全关键词化的 `errMsg`、platform、mode 元信息，以及 assessment/paymentAttempt/requestId 后缀。analytics 上传为 fire-and-forget，失败仅输出脱敏类别，不能阻断支付。

禁止任何诊断包含：signData、paySig、signature、AppKey、session key、openid、完整订单号、用户答案、完整报告正文。

## 8. 退款

- `FULL_REPORT_REFUNDED`：完整报告读取返回 403。
- purchases/purchases latest 对退款权益返回 `REFUNDED` 与 `unlocked=false`。
- 退款后保留免费结果概览，禁止展示缓存的完整报告正文。
- 退款报告可为同一 assessment 创建新的 attempt 后重新购买；不得复用旧退款 attempt/order。

## 9. 微信开发者工具与构建目录

- 微信开发者工具可能占用 `dist/build/mp-weixin`，导致 `EPERM` 或访问拒绝。
- 先关闭 `Weixin.exe` 和 `WeChatAppEx.exe`；确认无残留进程后，只允许删除生成目录 `dist/build/mp-weixin`。
- 使用 `npm.cmd run build:mp-weixin` 重建；确认 `common/vendor.js` 已重新生成，并在 `services/wechat-virtual-payment.js` 中检索诊断标识。
- 不使用 `git clean`、`git reset` 或删除源码目录解决构建占用。

## 10. 开发到现网操作清单

1. 在沙箱完成 prepare、callback、confirm、幂等和退款自动化测试。
2. 校验生产配置存在性：env=0、production AppKey、AppID、offerId、productId、价格。
3. 运行类型检查、支付专项测试和微信构建检查。
4. 提交前确认构建产物不入 Git、无密钥/签名/答案泄露。
5. 上传体验版后，以真实微信客户端验证 Android 与 iOS。
6. 付款后确认 attempt/order/entitlement 状态一致，并可重复读取 full-report。
7. 验证退出重进恢复、重复点击防护、取消、网络失败与退款行为。
8. 将生产 DB、PM2 commit、message-push 访问日志列入运维审计，不在客户端日志中暴露敏感数据。

## 11. Android / iOS 真实支付验收清单

- [x] Android：可打开正式付款页，真实付款成功，完整报告读取成功。
- [x] iOS：可打开正式付款页，真实付款成功，完整报告读取成功。
- [x] 前端不以支付组件 success 直接解锁；通过服务端 confirm/entitlement 获取报告。
- [x] 安全诊断已保留，且不含签名、密钥、openid 或答案。
- [ ] 运维审计：直接核验生产 SQLite 的两笔 attempt/order/entitlement 记录、PM2 运行 commit 与 message-push 日志。

## 12. 当前参考提交

| 范围 | 参考提交 | 说明 |
| --- | --- | --- |
| 小程序前端 | `934f3d1` | 安全虚拟支付回调诊断基线 |
| 后端本地参考 | `43c113c` | 全终端虚拟支付退款支持 |

生产数据库订单记录和 PM2 实际运行 commit 尚未在本轮直接读取；它们是后续运维审计项，不阻塞已完成的 Android/iOS 现网功能验收。
