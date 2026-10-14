
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPriceOracle {
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
}

contract OracleFixture {
    address public oracle;

    constructor(address oracle_) {
        oracle = oracle_;
    }

    function readPrice() external view returns (int256 price) {
        (, price, , , ) = IPriceOracle(oracle).latestRoundData();
    }
}
