# Synthetic 开发样例

这些 JSON 是根据妙妙屋X文档手工构造的输入样例，**不是从真实主控抓取的响应**，不是官方schema，也不证明完整字段兼容。文件名与说明标记来源，JSON本身保持业务响应形状。

- `snapshot-basic.json`：在线、零值和离线；容量采用明确的字节值，适合校验换算与缺省。
- `snapshot-disabled.json`：只提供文档保证的 enabled=false。
- `snapshot-hidden-names.json`：名称隐藏与稀疏指标，验证不能凭空获取身份。
- `snapshot-duplicate-names.json`：同名且缺少可区分属性，验证身份歧义不能静默通过。

后续测试可对 basic 样例交换数组顺序，检验身份绑定；不要以当前下标作为永久ID。CFSM预期输出需要核实其源码后单独制定，不能直接从转换函数生成断言。

暂未提供 Ping/历史/WS 的“官方响应样例”：文档未完整定义的结构应等待真实响应验证，再以 observed 或 synthetic 区分保存。
