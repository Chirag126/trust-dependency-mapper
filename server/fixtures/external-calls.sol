
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IExternalService {
    function execute() external returns (bool);
}

contract ExternalCallsFixture {
    address public service;
    address public owner;

    constructor(address service_) {
        service = service_;
        owner = msg.sender;
    }

    function callService() external returns (bool) {
        return IExternalService(service).execute();
    }

    function sendEther(address payable recipient) external payable {
        require(msg.sender == owner, "not owner");
        (bool success, ) = recipient.call{value: msg.value}("");
        require(success, "transfer failed");
    }
}
