/* eslint-disable camelcase */
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { MaxUint256, ZeroAddress } from "ethers";
import { ethers, network } from "hardhat";

import { request_fork } from "@/test/utils";
import { AladdinZap, ConcentratorGateway, ConcentratorVaultForAsdCRV, IConvexBooster, IERC20 } from "@/types/index";
import { ADDRESS, AVAILABLE_VAULTS, DEPLOYED_CONTRACTS, DEPLOYED_VAULTS, TOKENS, ZAP_ROUTES } from "@/utils/index";

const strategies: {
  factory: string;
  impls: { [name: string]: string };
} = {
  factory: "0x23384DD4380b3677b829C6c88c0Ea9cc41C099bb",
  impls: {
    AutoCompoundingConvexFraxStrategy: "0x6Cc546cE582b0dD106c231181f7782C79Ef401da",
    AutoCompoundingConvexCurveStrategy: ZeroAddress,
    ManualCompoundingConvexCurveStrategy: "0xE25f0E29060AeC19a0559A2EF8366a5AF086222e",
    ManualCompoundingCurveGaugeStrategy: "0x188bd82BF11cC321F7872acdCa4B1a3Bf9a802dE",
    CLeverGaugeStrategy: ZeroAddress,
    AMOConvexCurveStrategy: "0x2be5B652836C630E15c3530bf642b544ae901239",
  },
};

const POOL_FORK_CONFIG: {
  [name: string]: {
    height: number;
    pid: number;
    deployer: string;
    holder: string;
    amount: string;
    harvest: boolean;
  };
} = {
  "CRV/sdCRV-v2": {
    height: 17518880,
    pid: 9,
    deployer: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf",
    holder: "0xb0e83C2D71A991017e0116d58c5765Abc57384af",
    amount: "0.001",
    harvest: true,
  },
  "sUSD/crvUSD": {
    height: 17634884,
    pid: 10,
    deployer: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf",
    holder: "0x3F7aA1a6aF4Bc3Ac327dc2130D4e8F1fF5Aa32c2",
    amount: "100",
    harvest: false,
  },
  "ETH/ALD": {
    height: 17713930,
    pid: 11,
    deployer: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf",
    holder: "0x28c921adAC4c1072658eB01a28DA06b5F651eF62",
    amount: "1000",
    harvest: true,
  },
  "crvUSD/ETH/CRV": {
    height: 17839400,
    pid: 12,
    deployer: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf",
    holder: "0xeCb456EA5365865EbAb8a2661B0c503410e9B347",
    amount: "10",
    harvest: true,
  },
  "hyUSD/eUSD": {
    height: 18524680,
    pid: 13,
    deployer: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf",
    holder: "0xeCb456EA5365865EbAb8a2661B0c503410e9B347",
    amount: "100",
    harvest: true,
  },
  "ETH+/ETH": {
    height: 18524680,
    pid: 13,
    deployer: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf",
    holder: "0xeCb456EA5365865EbAb8a2661B0c503410e9B347",
    amount: "0.1",
    harvest: true,
  },
  "eUSD/FRAXBP": {
    height: 18524680,
    pid: 13,
    deployer: "0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf",
    holder: "0xf83deAdE1b0D2AfF07700C548a54700a082388bE",
    amount: "100",
    harvest: true,
  },
};

const BOOSTER = "0xF403C135812408BFbE8713b5A23a04b3D48AAE31";
const PRINT_ZAP = true;
const POOLS = (process.env.POOLS || "").split(",");

describe("ConcentratorGeneralVault.asdCRV.add.spec", async () => {
  let deployer: HardhatEthersSigner;
  let signer: HardhatEthersSigner;

  let lpToken: IERC20;
  let vault: ConcentratorVaultForAsdCRV;
  let zap: AladdinZap;
  let gateway: ConcentratorGateway;

  if (PRINT_ZAP) {
    console.log("{");
    DEPLOYED_VAULTS.asdCRV.forEach(({ name }) => {
      const config = AVAILABLE_VAULTS[name];
      const fork = POOL_FORK_CONFIG[name];
      if (fork === undefined) {
        return;
      }
      if (!POOLS.includes(name)) return;

      console.log(`  "${name}": [`);
      Object.entries(config.deposit).forEach(([symbol, routes]) => {
        if (symbol === "WETH") {
          console.log(
            `    {"symbol": "ETH", "address": "${ZeroAddress}", "routes": [${routes
              .map((x) => `"0x${x.toString(16)}"`)
              .join(",")}]},`
          );
        }
        console.log(
          `    {"symbol": "${symbol}", "address": "${TOKENS[symbol].address}", "routes": [${routes
            .map((x) => `"0x${x.toString(16)}"`)
            .join(",")}]},`
        );
      });
      console.log(`  ],`);
    });
    console.log("}");
  }

  const genTests = async (
    name: string,
    strategy: string,
    fees: {
      withdraw: number;
      harvest: number;
      platform: number;
    }
  ) => {
    const config = AVAILABLE_VAULTS[name];
    const fork = POOL_FORK_CONFIG[name];
    if (fork === undefined) {
      return;
    }
    if (!POOLS.includes(name)) return;

    context(`asdCRV vault for pool: ${name}`, async () => {
      beforeEach(async () => {
        request_fork(fork.height, [
          fork.deployer,
          fork.holder,
          "0x07dA2d30E26802ED65a52859a50872cfA615bD0A",
          DEPLOYED_CONTRACTS.CommunityMultisig,
          DEPLOYED_CONTRACTS.ManagementMultisig,
          DEPLOYED_CONTRACTS.Concentrator.Treasury,
        ]);
        deployer = await ethers.getSigner(fork.deployer);
        signer = await ethers.getSigner(fork.holder);
        const manager = await ethers.getSigner(DEPLOYED_CONTRACTS.ManagementMultisig);
        const owner = await ethers.getSigner(DEPLOYED_CONTRACTS.Concentrator.Treasury);

        await deployer.sendTransaction({ to: signer.address, value: ethers.parseEther("10") });
        await deployer.sendTransaction({ to: manager.address, value: ethers.parseEther("10") });
        await deployer.sendTransaction({ to: owner.address, value: ethers.parseEther("10") });

        lpToken = await ethers.getContractAt("MockERC20", ADDRESS[`${config.token}_TOKEN`]);

        const TokenZapLogic = await ethers.getContractFactory("TokenZapLogic", deployer);
        const logic = await TokenZapLogic.deploy();

        // upgrade zap contract
        const proxyAdmin = await ethers.getContractAt("ProxyAdmin", DEPLOYED_CONTRACTS.Concentrator.ProxyAdmin, owner);
        const AladdinZap = await ethers.getContractFactory("AladdinZap", deployer);
        const impl = await AladdinZap.deploy();
        await proxyAdmin.upgrade(DEPLOYED_CONTRACTS.AladdinZap, impl.getAddress());
        zap = await ethers.getContractAt("AladdinZap", DEPLOYED_CONTRACTS.AladdinZap, manager);

        // setup withdraw zap
        await zap.updatePoolTokens([ADDRESS[`${config.token}_POOL`]], [lpToken.getAddress()]);
        if (ADDRESS[`${config.token}_DEPOSIT`]) {
          await zap.updatePoolTokens([ADDRESS[`${config.token}_DEPOSIT`]], [lpToken.getAddress()]);
        }
        for (const [symbol, routes] of Object.entries(config.withdraw)) {
          await zap.updateRoute(lpToken.getAddress(), ADDRESS[symbol], routes);
        }

        gateway = await ethers.getContractAt(
          "ConcentratorGateway",
          DEPLOYED_CONTRACTS.Concentrator.ConcentratorGateway,
          owner
        );
        const gatewayOwner = await ethers.getSigner(await gateway.owner());
        await gateway.connect(gatewayOwner).updateLogic(logic.getAddress());

        const strategyName = `ManualCompounding${strategy}Strategy`;
        const factory = await ethers.getContractAt("ConcentratorStrategyFactory", strategies.factory, deployer);
        const strategyAddress = await factory.createStrategy.staticCall(strategies.impls[strategyName]);
        await factory.createStrategy(strategies.impls[strategyName]);
        const strategyContract = await ethers.getContractAt(strategyName, strategyAddress, deployer);
        const underlying = ADDRESS[`${config.token}_TOKEN`];

        vault = await ethers.getContractAt(
          "ConcentratorVaultForAsdCRV",
          DEPLOYED_CONTRACTS.Concentrator.StakeDAO.sdCRV.ConcentratorVaultForAsdCRV,
          owner
        );
        const vaultOwner = await ethers.getSigner(await vault.owner());
        if (strategy === "ConvexCurve") {
          await strategyContract.initialize(vault.getAddress(), underlying, config.rewarder!, config.rewards);
        } else if (strategy === "CurveGauge") {
          await strategyContract.initialize(vault.getAddress(), underlying, config.gauge!, config.rewards);
        }
        await vault
          .connect(vaultOwner)
          .addPool(underlying, strategyAddress, fees.withdraw, fees.platform, fees.harvest);
        await vault.connect(vaultOwner).updateHarvester(ZeroAddress);
      });

      context("deposit", async () => {
        const amountLP = ethers.parseEther(fork.amount);
        if (config.deposit.WETH !== undefined) {
          it("deposit, withdraw as ETH, deposit from ETH", async () => {
            // zap to ETH
            await lpToken.connect(signer).approve(zap.getAddress(), amountLP);
            const etherBefore = await ethers.provider.getBalance(signer.address);
            const tx = await zap.connect(signer).zapFrom(lpToken.getAddress(), amountLP, ZeroAddress, 0);
            const receipt = await tx.wait();
            const baseFee = (await ethers.provider.getBlock("latest"))?.baseFeePerGas!;
            const effectiveGasPrice = tx.gasPrice ? tx.gasPrice : baseFee + tx.maxPriorityFeePerGas!;
            const etherAfter = await ethers.provider.getBalance(signer.address);
            expect(etherAfter + receipt!.gasUsed * effectiveGasPrice).gt(etherBefore);

            // zap from ETH
            const amountIn = etherAfter + receipt!.gasUsed * effectiveGasPrice - etherBefore;
            await gateway
              .connect(signer)
              .deposit(
                vault.getAddress(),
                fork.pid,
                ZeroAddress,
                lpToken.getAddress(),
                amountIn,
                config.deposit.WETH,
                0,
                {
                  value: amountIn,
                }
              );
            const zapSharesOut = await vault.getUserShare(fork.pid, signer.address);
            console.log(
              `amountLP[${ethers.formatEther(amountLP)}]`,
              `amountIn[${ethers.formatEther(amountIn)}]`,
              `zapSharesOut[${ethers.formatEther(zapSharesOut)}]`
            );
            expect(zapSharesOut).to.gt(0n);
            expect(zapSharesOut).to.closeTo(amountLP, (amountLP * 2n) / 100n); // 2% error
          });
        }

        Object.entries(config.deposit).forEach(([symbol, routes]) => {
          it(`deposit, withdraw as ${symbol}, deposit from ${symbol}`, async () => {
            const token = await ethers.getContractAt("MockERC20", ADDRESS[symbol], signer);
            // zap to token
            await lpToken.connect(signer).approve(zap.getAddress(), amountLP);
            const tokenBefore = await token.balanceOf(signer.address);
            await zap.connect(signer).zapFrom(lpToken.getAddress(), amountLP, token.getAddress(), 0);
            const tokenAfter = await token.balanceOf(signer.address);
            expect(tokenAfter).to.gt(tokenBefore);
            // zap from token
            const amountIn = tokenAfter - tokenBefore;
            await token.approve(gateway.getAddress(), MaxUint256);
            await gateway
              .connect(signer)
              .deposit(vault.getAddress(), fork.pid, token.getAddress(), lpToken.getAddress(), amountIn, routes, 0);
            const zapSharesOut = await vault.getUserShare(fork.pid, signer.address);
            console.log(
              `amountLP[${ethers.formatEther(amountLP)}]`,
              `amountIn[${ethers.formatUnits(amountIn, TOKENS[symbol].decimals)}]`,
              `zapSharesOut[${ethers.formatEther(zapSharesOut)}]`
            );
            expect(zapSharesOut).to.gt(0n);
            expect(zapSharesOut).to.closeTo(amountLP, (amountLP * 2n) / 100n); // 2% error
          });
        });
      });

      if (fork.harvest) {
        context("harvest", async () => {
          const amountLP = ethers.parseEther(fork.amount);
          let booster: IConvexBooster;
          let firstCall = true;

          beforeEach(async () => {
            booster = await ethers.getContractAt("IConvexBooster", BOOSTER, deployer);
            for (const reward of config.rewards) {
              const symbol = Object.entries(ADDRESS).find(([, address]) => address === reward)![0];
              if (symbol === "CRV") continue;
              const routes = ZAP_ROUTES[symbol].CRV;
              if (firstCall) {
                console.log(
                  `harvest zap ${symbol}=>CRV:`,
                  `from[${reward}]`,
                  `to[${ADDRESS.CRV}]`,
                  `routes[${routes.toString()}]`
                );
              }
              await zap.updateRoute(reward, ADDRESS.CRV, routes);
            }
            firstCall = false;

            await lpToken.connect(signer).approve(vault.getAddress(), amountLP);
            await vault.connect(signer).deposit(fork.pid, signer.address, amountLP);
            const sharesOut = await vault.getUserShare(fork.pid, signer.address);
            expect(sharesOut).to.eq(amountLP);
          });

          it("should succeed", async () => {
            if (config.convexCurveID) {
              await booster.earmarkRewards(config.convexCurveID);
            }
            const timestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
            await network.provider.send("evm_setNextBlockTimestamp", [timestamp + 86400 * 7]);
            await network.provider.send("evm_mine");

            const token = await ethers.getContractAt(
              "MockERC20",
              DEPLOYED_CONTRACTS.Concentrator.StakeDAO.sdCRV.asdCRV,
              deployer
            );
            const amount = await vault.harvest.staticCall(fork.pid, deployer.address, 0);
            const before = await token.balanceOf(vault.getAddress());
            await vault.harvest(fork.pid, deployer.address, 0);
            const after = await token.balanceOf(vault.getAddress());
            console.log("harvested sdCRV:", ethers.formatEther(amount), "asdCRV:", ethers.formatEther(after - before));
            expect(amount).gt(0n);
          });
        });
      }
    });
  };

  DEPLOYED_VAULTS.asdCRV.forEach(({ name, fees, strategy }) => {
    genTests(name, strategy, fees);
  });
});
