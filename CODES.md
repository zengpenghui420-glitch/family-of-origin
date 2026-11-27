# 验证码说明（原生家庭健康度测试）

- 格式：`FO` + 4 位字符，字符表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（无 I/L/O/0/1）
- 正则：`/^FO[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/i`
- 示例形态：`FOXXXX`（此处不公布可售卖码）
- Vault quiz key：`family`（发码池 `pools/family.txt`，由 vault 维护，不在本仓库）
- 每码最多使用 **3** 次（跨设备共享计数，由 vault `POST /redeem` 扣次）
- 订单号不是验证码，不走 vault，也不写入 Mantle。页面只接受 `P` + 18 位，并拒绝重复块和逐位 ±1。格式通过后直接开始。显示次数按订单号记在这台浏览器的 `family_order_uses`。记满 3 次后仍可进入，提示「验证成功」
- **重新测试**：清除会话解锁后需再次输入码并 redeem，会再扣 1 次
- **查看上次结果**：只读本机 `localStorage` 键 `family_last_result`，不扣次
- 解锁态键名：`family_unlocked`、`family_code`（会话存储，对齐 mental-age / love-values）
- 本仓库**不**存放可卖验证码明文，也**不**接入 Mantle

造码（本机 companion，勿把码写进 git）：

```bash
/workspace/quiz-code-api/scripts/mint.sh family <CODE> 3
```

或见 `tools/mint.sh`。该脚本只打印用法，不会生成或写入真码。
