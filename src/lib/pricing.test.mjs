import { test } from "node:test";
import assert from "node:assert/strict";
import { financials, bookingDueNow, fetchFeeConfig, FALLBACK_FEE_CONFIG, formatMoney, feeLabel } from "./pricing.ts";
const config = {service_fee_rate: 0.05, service_fee_cap: 50, currency: "GHS"};
for (const [price, fee, total, deposit, dueNow] of [[120,600,12600,4800,5400],[99.99,500,10499,4000,4500],[2000,5000,205000,80000,85000],[0,0,0,0,0]]) {
 test(`acceptance: ${price}`, () => { const f = financials(price, config); assert.deepEqual([f.fee,f.total,f.deposit,f.dueNow], [fee,total,deposit,dueNow]); assert.equal(f.balance, f.price-f.deposit); });
}
test("invalid and nonpositive prices", () => { for (const p of [-100, NaN, Infinity, -Infinity]) assert.equal(financials(p,config).fee,0); });
test("half rounding and cap", () => { assert.equal(financials(0.1,config).fee,1); assert.equal(financials(1234.56,{...config,service_fee_cap:100}).fee,6173); assert.equal(financials(2000,config).capped,true); assert.match(feeLabel(config,true),/capped/); });
test("charge is snapshot deposit plus fee, including legacy null", () => { assert.equal(bookingDueNow({deposit_amount:40,sheree_fee_amount:5}),4500); assert.equal(bookingDueNow({deposit_amount:40,sheree_fee_amount:null}),4000); assert.equal(bookingDueNow({deposit_amount:"40.00",sheree_fee_amount:"5.01"}),4501); });
test("changed config changes previews without changing professional price", () => { assert.equal(financials(120,{...config,service_fee_rate:0.07}).total,12840); assert.equal(financials(120,config).price,12000); });
test("config is fetched afresh and validated", async () => { let calls=0; const client={rpc:async()=>({data:{...config,service_fee_rate:++calls/100},error:null})}; assert.equal((await fetchFeeConfig(client)).service_fee_rate,0.01); assert.equal((await fetchFeeConfig(client)).service_fee_rate,0.02); });
test("failed config uses logged emergency fallback", async () => { const original=console.error; let logged=false; console.error=()=>{logged=true}; try { assert.deepEqual(await fetchFeeConfig({rpc:async()=>({data:null,error:new Error("offline")})}),FALLBACK_FEE_CONFIG); assert.equal(logged,true); } finally {console.error=original;} });
test("format at edge keeps pesewas", () => assert.match(formatMoney(104.99,config.currency),/104\.99/));
