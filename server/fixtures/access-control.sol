
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AccessControlFixture {
    address public owner;
    mapping(address => bool) public admins;

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender], "not admin");
        _;
    }

    function grantAdmin(address account) external {
        require(msg.sender == owner, "not owner");
        admins[account] = true;
    }

    function restrictedAction() external onlyAdmin {
        // Protected operation.
    }
}
