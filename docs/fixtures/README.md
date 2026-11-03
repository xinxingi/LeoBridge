# Synthetic 开发样例

这些 JSON 是根据妙妙屋X文档手工构造的输入样例，**不是从真实主控抓取的响应**，不是官方schema，也不证明完整字段兼容。文件名与说明标记来源，JSON本身保持业务响应形状。

- `snapshot-basic.json`：在线、零值和离线；容量采用明确的字节值，适合校验换算与缺省。
- `snapshot-disabled.json`：只提供文档保证的 enabled=false。
- `snapshot-hidden-names.json`：名称隐藏与稀疏指标，验证不能凭空获取身份。
- `snapshot-duplicate-names.json`：同名且缺少可区分属性，验证身份歧义不能静默通过。

可对 basic 样例交换数组顺序，检验身份绑定；不要以当前下标作为永久ID。预期输出应依据[消费者契约](../research/frontend-contract.md)和源事实制定，不能直接从转换函数生成断言。

此目录只保存四份合成快照。Ping/历史/WS的实测结构见[输入契约](../research/upstream-contract.md)，测试内另有合成样例；真实原始响应保持私有，不作为公开fixture分发。
