
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProxyImplementation {
    uint256 public value;

    function setValue(uint256 newValue) external {
        value = newValue;
    }
}

contract ProxyFixture {
    address public implementation;
    address public owner;

    constructor(address implementation_) {
        implementation = implementation_;
        owner = msg.sender;
    }

    function upgradeTo(address nextImplementation) external {
        require(msg.sender == owner, "not owner");
        implementation = nextImplementation;
    }

    fallback() external payable {
        address target = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
