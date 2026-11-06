# 原生家庭健康度测试 · 你的原生家庭对你影响有多大

付费移动端 H5 娱乐测验。18 道原创 Likert 题，六维画像 + 原生家庭健康指数（0–100）+ 六档锐评 + 雷达。

## 在线地址

https://zengpenghui420-glitch.github.io/family-of-origin/

## 产品要点

| 项 | 说明 |
|---|---|
| 题目 | 18 题 · 五级自评（完全不像我 → 非常像我） |
| 维度 | 情感接住 / 边界呼吸 / 沟通通道 / 角色轻负 / 价值温度 / 安全底盘 |
| 结果 | 健康指数 0–100 + 档位 + 最薄的一面 + 六维雷达 + 特征表现 + 自处/边界小建议 |
| 验证码 | `FO****`，每码 3 次；vault quiz key `family`；**不接 Mantle** |
| 重新测试 | 清会话解锁 → 再弹码 → redeem（扣次） |
| 查看上次 | 仅读本机 `family_last_result`，不扣次 |

## 免责声明

本测试为娱乐向自我观察，非正式心理测量或家庭评估，不能替代专业心理咨询、心理治疗或临床诊断。「原生家庭健康指数」只是对你童年/成长期家庭互动氛围的趣味画像，不是对父母的审判，也不等于你现在过得好不好；结果会受回忆偏差与当下情绪影响。若题目勾起强烈不适，请随时停下，优先照顾自己。

看见来处是为了更温和地走向自己，不是为了给谁定罪。家庭没有标准答案。若相关体验已明显影响睡眠、工作或关系，寻求现实支持（可信赖的人、正规心理咨询/医院心理科）是勇敢的选择，而不是软弱。

## 文件

- `index.html` — 单文件 H5
- `.nojekyll` — GitHub Pages 跳过 Jekyll
- `CODES.md` — 验证码格式与规则（无可卖码）
- `tools/mint.sh` — 只打印 vault 造码用法

## 本地预览

```bash
python3 -m http.server 8080
```

浏览器打开 http://127.0.0.1:8080/ 。未解锁时点「开始测试」会要求验证码；「查看上次结果」只读本地缓存。

## GitHub Pages

从 `main` 分支的根目录 `/` 发布：

1. 仓库 Settings → Pages → Build and deployment → Deploy from a branch
2. Branch 选 `main`，Folder 选 `/ (root)`，保存
3. 确认仓库根目录有 `.nojekyll`

也可用 API（需有 Pages 管理权限）：

```bash
gh api --method POST repos/zengpenghui420-glitch/family-of-origin/pages \
  -f build_type=legacy \
  -f 'source[branch]=main' \
  -f 'source[path]=/'
```

## 版权

题目、档位名与结果文案均为原创中文日常情景。不使用临床或病理标签，也不照搬第三方原生家庭题库或档名。
