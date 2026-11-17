import assert from "node:assert/strict";
import test from "node:test";
import { normalize } from "./scout.mjs";

test("matches remote photo roles and filters duplicates and incompatible listings", () => {
  const board = { provider:"ashby", company:"Example" };
  const job = { id:"1", title:"Photo Retoucher", isRemote:true, jobUrl:"https://example.com/job",
    location:"Remote US", compensation:{ compensationTierSummary:"$35/hour" } };
  const results = normalize(board,{jobs:[job,job,
    {...job,id:"2",isRemote:false,location:"Seattle Hybrid",workplaceType:"Hybrid"},
    {...job,id:"3",title:"Account Manager"},
    {...job,id:"4",jobUrl:"javascript:alert(1)"},
    {...job,id:"5",isListed:false}]});
  assert.equal(results.length,1);
  assert.equal(results[0].posted_pay,"$35/hour");
  assert.ok(results[0].tags.includes("retouching"));
  assert.throws(() => normalize(board,{items:[]}),/Unexpected/);
});
test("reads Lever workplace fields and uses the Ashby posting URL if no ID is present", () => {
  const lever = normalize({ provider:"lever", company:"Example" },[{id:"lever1",text:"Picture Editor",
    workplaceType:"remote",categories:{location:"United States"},hostedUrl:"https://example.com/lever"}]);
  assert.equal(lever[0].external_id,"lever1");
  const ashby = normalize({provider:"ashby",company:"Example"},{jobs:[{title:"Photography Evaluator",
    workplaceType:"Remote",jobUrl:"https://example.com/ashby"}]});
  assert.equal(ashby[0].external_id,"https://example.com/ashby");
});
