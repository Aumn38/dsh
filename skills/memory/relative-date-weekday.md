# Skill：relative-date-weekday

**Name:** relative-date-weekday

## When to use / 触发条件
- 用户问“今天/明天/后天/昨天/下周三是星期几/几号”，或让你按相对日期安排提醒。
- 用户要求“只回复星期几/只回复日期”，或对输出格式有严格限制。

## Steps / 步骤
1. **先取本机当前日期、时间和时区**
   ```bash
   date '+%Y-%m-%d %H:%M:%S %A %Z'
   ```
   不要凭记忆或硬编码日期。
2. **计算目标日期**
   - 相对天数可用 `date -d 'tomorrow'`、`date -d '2 days'`、`date -d 'yesterday'`。
   - 需要稳定中文星期时用 Python 映射，避免依赖系统 locale：
     ```bash
     python3 - <<'PY'
     import datetime
     wd = ['星期一','星期二','星期三','星期四','星期五','星期六','星期日']
     d = datetime.date.today() + datetime.timedelta(days=1)
     print(d.isoformat(), wd[d.weekday()])
     PY
     ```
3. **核对**
   - 把“目标日期 + 星期”一起打印出来检查（例如 `2026-11-06 星期五`），确认没有跨月/跨年错误。
4. **按最小格式回复**
   - 若用户说“只回复星期几”，只输出“星期五”，不要带日期、解释、标点或“明天是”之类的前缀。

## Example / 示例
用户：“明天是星期几？只回复星期几。”

执行：
```bash
python3 - <<'PY'
import datetime
wd = ['星期一','星期二','星期三','星期四','星期五','星期六','星期日']
d = datetime.date.today() + datetime.timedelta(days=1)
print(d.isoformat(), wd[d.weekday()])
PY
```

输出 `2026-11-06 星期五`，核对后只回复：
```
星期五
```

## Notes / 注意事项
- 以主人本地时间为准，不要自行换算时区。
- “下周”“月底”这类模糊说法先确认具体日期，不要猜。
- `date` 命令失败或系统时间明显异常时，先说明情况，不要编造星期。
