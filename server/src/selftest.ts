import assert from "node:assert/strict";
import { analyzeFiles } from "./analyzer";

const source=`
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IOracle { function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80); }
contract Test {
 address public owner;
 address public oracle = 0x0000000000000000000000000000000000000001;
 constructor(){owner=msg.sender;}
 function quote() external view returns(int256){(,int256 p,,,) = IOracle(oracle).latestRoundData(); return p;}
 function upgradeTo(address x) external { require(msg.sender==owner); (bool ok,)=x.delegatecall(""); require(ok); }
}
`;
const a=analyzeFiles([{path:"Test.sol",content:source}],"self-test");
assert.equal(a.status,"completed");
assert.ok(a.dependencies.some(d=>d.type==="oracle"),"oracle dependency missing");
assert.ok(a.dependencies.some(d=>d.type==="owner"),"owner dependency missing");
assert.ok(a.dependencies.some(d=>d.type==="proxy"),"upgrade dependency missing");
assert.ok(a.summary.upgradeable,"upgradeable summary missing");
assert.ok(a.findings.some(f=>f.title.includes("Delegatecall")),"delegatecall finding missing");
assert.ok(a.logs.some(l=>l.level==="success"),"completion log missing");
console.log("TDM self-test: PASS");
