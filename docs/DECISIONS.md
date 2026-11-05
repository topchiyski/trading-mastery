# Calculation decisions

Interpretations made where `SPEC.md` leaves room. Code lives in `packages/core`; tests pin each rule.

| Topic                | Decision                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantities           | Whole shares only (positive safe integers). Fractional shares are rejected as invalid.                                                                                     |
| Fees sign            | `commission` and `otherFees` are stored as non-negative costs; importers flip IBKR's negative commissions.                                                                 |
| Tie-breaking         | Same timestamp → broker exec ID (executions with one sort first) → `id` (insertion order).                                                                                 |
| Rejected fills       | Invalid executions and sells exceeding the position are reported and **not applied**; callers must block commit while errors exist.                                        |
| Partial exits        | Cost removed at the running average cost (`mulDiv`, half away from zero); the last sell takes the exact remainder so Σ realised = proceeds − cost.                         |
| Open trades          | `grossPnl` / `netPnl` / `returnPct` are null until closed. `realisedNet` = realised gross − all fees paid so far.                                                          |
| Holding period       | NY dates. Calendar days = date difference. Trading days = NYSE sessions in (open date, close date], so Fri→Mon = 1, same day = 0.                                          |
| NYSE calendar        | Rule-based holidays (incl. Good Friday, Juneteenth from 2022, Sat New Year not observed) plus a small list of special closures. Early closes are ignored.                  |
| Initial risk         | Planned-risk override (if > 0) wins. Otherwise (first entry − stop) × first qty; null if no stop or stop ≥ entry → trade excluded from R stats.                            |
| Break-even           | `                                                                                                                                                                          | net | < threshold` (default $1). Win rate = wins ÷ (wins + losses). Expectancy $ averages over all trades incl. break-evens. |
| Streaks              | Close order; break-even trades neither extend nor break a streak.                                                                                                          |
| Profit factor/payoff | Null (shown as “n/a”) when there are no losses.                                                                                                                            |
| Equity points        | One point per NYSE trading day. Events on weekends/holidays roll to the next trading day; events before the start land on day 1; events after the end are dropped.         |
| External flows       | Only deposits and withdrawals are external (excluded from TWR). Dividends, interest and non-trade fees count as performance.                                               |
| TWR                  | Daily return = (equity − today's external flow − yesterday's equity) ÷ yesterday's equity (flows at end of day); 0 when yesterday's equity ≤ 0.                            |
| Max drawdown         | $: on cumulative performance (realised P&L + income), peak starting at 0, so withdrawals are not drawdowns. %: on the TWR index, peak starting at 1. Both reported as ≤ 0. |
| Sharpe / Sortino     | Daily TWR returns, risk-free 0, annualised × √252. Sharpe uses sample stdev; Sortino uses downside deviation over all days (target 0).                                     |
| Cumulative R         | Close order, trades without R skipped and counted; R drawdown measured from a peak starting at 0.                                                                          |
