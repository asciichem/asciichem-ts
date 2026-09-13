// Cross-engine parsing benchmark (shared workload; see
// asciichem-ruby benchmarks/README.md). Run: npm run bench
import { parse } from "../dist/index.js";

const WORKLOAD = ["H_2O", "Ca^2+", "SO_4^2-", "(R)-CH_3CH(OH)COOH",
  "2H_2 + O_2 -> 2H_2O", "N_2 + 3H_2 <=>[Fe][400C] 2NH_3",
  "C1-C-C-C-C-C1", "CH_3-CH_2-OH",
  '^14C @name("carbon-14") @cas("14104-86-4")',
  "A ->[heat] B ->[cool] C"];

for (const s of WORKLOAD) parse(s); // warm-up + correctness gate

const N = 2000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) for (const s of WORKLOAD) parse(s);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`peggy: ${N} batches of 10 in ${ms.toFixed(1)} ms`);
console.log(`batch: ${(ms / N).toFixed(2)} ms; per input: ${(ms / N / 10 * 1000).toFixed(0)} µs`);
