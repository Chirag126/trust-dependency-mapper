// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOracle {
    function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80);
}

contract SampleVault {
    address public owner;
    address public oracle = 0x0000000000000000000000000000000000000001;
    address public bridge = 0x0000000000000000000000000000000000000002;

    constructor() {
        owner = msg.sender;
    }

    function setOracle(address next) external {
        require(msg.sender == owner, "not owner");
        oracle = next;
    }

    function quote() external view returns (int256) {
        (, int256 price,,,) = IOracle(oracle).latestRoundData();
        return price;
    }

    function emergencyUpgrade(address implementation) external {
        require(msg.sender == owner, "not owner");
        (bool ok,) = implementation.delegatecall("");
        require(ok);
    }
}
