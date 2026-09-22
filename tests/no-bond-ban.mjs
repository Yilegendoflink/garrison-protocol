// 盟约禁用默认开着：`new NativeSession(data,{seed})` 会按 seed 随机禁 3 个核心 + 4 个附加盟约
// （见 `dist/native-bond-ban.js` 与 `AGENTS.md` 的「盟约禁用」条目）。
//
// 绝大多数单元测试需要的是**完整名册**（点名 gain 某个干员、按盟约取成员、统计商店阶级概率），
// 所以在这些测试里构造会话时显式关掉本局禁用：
//   new NativeSession(NATIVE_DATA,{seed:1,bondBan:NO_BOND_BAN})
// 或者用 `tests/effects-harness.mjs` 的 `openBattle`（它已经默认关掉）。
//
// 禁用机制本身的回归在 `tests/native-bond-ban.test.mjs`，那里显式传 bonds／exempt，
// 不要把这个常量当成「禁用不存在」的借口。
export const NO_BOND_BAN={bonds:[],exempt:{}};
