import { PaymasterMode } from "@biconomy/paymaster";
import { TestData } from "../../../tests";
import { createSmartAccountClient } from "../../account/src/index";
import { Hex, encodeFunctionData, parseAbi } from "viem";
import { DEFAULT_MULTICHAIN_MODULE, MultiChainValidationModule } from "@biconomy/modules";

describe("Account with MultiChainValidation Module Tests", () => {
  let mumbai: TestData;
  let baseSepolia: TestData;

  beforeEach(() => {
    // @ts-ignore: Comes from setup-e2e-tests
    [mumbai, baseSepolia] = testDataPerChain;
  });

  it("Should mint an NFT gasless on baseSepolia and mumbai", async () => {
    const {
      whale: { alchemyWalletClientSigner: signerMumbai, publicAddress: recipientForBothChains },
      biconomyPaymasterApiKey: biconomyPaymasterApiKeyMumbai,
      bundlerUrl: bundlerUrlMumbai,
      chainId: chainIdMumbai,
    } = mumbai;

    const {
      whale: { alchemyWalletClientSigner: signerBase },
      biconomyPaymasterApiKey: biconomyPaymasterApiKeyBase,
      bundlerUrl: bundlerUrlBase,
      chainId: chainIdBase,
    } = baseSepolia;

    const nftAddress: Hex = "0x1758f42Af7026fBbB559Dc60EcE0De3ef81f665e";

    const multiChainModule = await MultiChainValidationModule.create({
      signer: signerMumbai,
      moduleAddress: DEFAULT_MULTICHAIN_MODULE,
    });

    const [polygonAccount, baseAccount] = await Promise.all([
      createSmartAccountClient({
        chainId: chainIdMumbai,
        signer: signerMumbai,
        bundlerUrl: bundlerUrlMumbai,
        defaultValidationModule: multiChainModule,
        activeValidationModule: multiChainModule,
        biconomyPaymasterApiKey: biconomyPaymasterApiKeyMumbai,
      }),
      createSmartAccountClient({
        chainId: chainIdBase,
        signer: signerBase,
        bundlerUrl: bundlerUrlBase,
        defaultValidationModule: multiChainModule,
        activeValidationModule: multiChainModule,
        biconomyPaymasterApiKey: biconomyPaymasterApiKeyBase,
      }),
    ]);

    const moduleEnabled1 = await polygonAccount.isModuleEnabled(DEFAULT_MULTICHAIN_MODULE);
    const moduleActive1 = polygonAccount.activeValidationModule;
    expect(moduleEnabled1).toBeTruthy();
    expect(moduleActive1.getAddress()).toBe(DEFAULT_MULTICHAIN_MODULE);

    const moduleEnabled2 = await baseAccount.isModuleEnabled(DEFAULT_MULTICHAIN_MODULE);
    const moduleActive2 = polygonAccount.activeValidationModule;
    expect(moduleEnabled2).toBeTruthy();
    expect(moduleActive2.getAddress()).toBe(DEFAULT_MULTICHAIN_MODULE);

    const encodedCall = encodeFunctionData({
      abi: parseAbi(["function safeMint(address owner) view returns (uint balance)"]),
      functionName: "safeMint",
      args: [recipientForBothChains],
    });

    const transaction = {
      to: nftAddress,
      data: encodedCall,
    };

    const [partialUserOp1, partialUserOp2] = await Promise.all([
      baseAccount.buildUserOp([transaction], { paymasterServiceData: { mode: PaymasterMode.SPONSORED } }),
      polygonAccount.buildUserOp([transaction], { paymasterServiceData: { mode: PaymasterMode.SPONSORED } }),
    ]);

    expect(partialUserOp1.paymasterAndData).not.toBe("0x");
    expect(partialUserOp2.paymasterAndData).not.toBe("0x");

    // Sign the user ops using multiChainModule
    const returnedOps = await multiChainModule.signUserOps([
      { userOp: partialUserOp1, chainId: chainIdBase },
      { userOp: partialUserOp2, chainId: chainIdMumbai },
    ]);

    // Send the signed user ops on both chains
    const userOpResponse1 = await baseAccount.sendSignedUserOp(returnedOps[0] as any);
    const userOpResponse2 = await polygonAccount.sendSignedUserOp(returnedOps[1] as any);

    console.log(userOpResponse1.userOpHash, "MULTICHAIN BASE USER OP HASH");
    console.log(userOpResponse2.userOpHash, "MULTICHAIN POLYGON USER OP HASH");

    expect(userOpResponse1.userOpHash).toBeTruthy();
    expect(userOpResponse2.userOpHash).toBeTruthy();
  }, 30000);
});
