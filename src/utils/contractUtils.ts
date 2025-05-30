import { ethers } from 'ethers';

/**
 * Checks if a contract exists and is an NFT contract
 */
export const validateNFTContract = async (
  contractAddress: string, 
  provider: ethers.Provider
): Promise<{ valid: boolean; reason?: string }> => {
  try {
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return { valid: false, reason: 'Invalid Ethereum address format' };
    }
    
    // Check if contract exists with a timeout
    try {
      const code = await Promise.race([
        provider.getCode(contractAddress),
        new Promise<string>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout checking contract code')), 10000)
        )
      ]);
      
      if (code === '0x') {
        return { valid: false, reason: 'Contract not deployed at this address' };
      }
    } catch (codeError) {
      console.error('Error checking contract code:', codeError);
      return { valid: false, reason: 'Failed to verify contract deployment - network issues' };
    }
    
    // Try to detect if it's an NFT by checking for common ERC721/ERC1155 interfaces
    const contract = new ethers.Contract(
      contractAddress,
      [
        // ERC721
        'function supportsInterface(bytes4) view returns (bool)',
        'function balanceOf(address) view returns (uint256)',
        'function ownerOf(uint256) view returns (address)',
        // ERC1155
        'function balanceOfBatch(address[],uint256[]) view returns (uint256[])'
      ],
      provider
    );
    
    // Try to detect if it's ERC721 or ERC1155
    try {
      // ERC721 interface ID
      const isERC721 = await contract.supportsInterface('0x80ac58cd')
        .catch(() => false);
      
      // ERC1155 interface ID
      const isERC1155 = await contract.supportsInterface('0xd9b67a26')
        .catch(() => false);
      
      if (isERC721 || isERC1155) {
        return { valid: true };
      }
      
      // Fallback: try to call typical NFT functions
      const hasBalanceOf = await contract.balanceOf('0x0000000000000000000000000000000000000001')
        .then(() => true)
        .catch(() => false);
      
      const hasOwnerOf = await contract.ownerOf(1)
        .then(() => true)
        .catch(() => false);
      
      if (hasBalanceOf || hasOwnerOf) {
        return { valid: true };
      }
      
      // Additional fallback - check the contract bytecode for transfer event
      const bytecode = await provider.getCode(contractAddress);
      if (bytecode.includes('Transfer(') || bytecode.includes('5RANSFERE')) {
        return { valid: true, reason: 'Contract appears to implement transfer events' };
      }
      
      return { 
        valid: false, 
        reason: 'Contract does not appear to be an ERC721 or ERC1155 NFT'
      };
    } catch (error) {
      // If we can't determine for sure, we'll assume it's valid to allow users to try
      return { valid: true };
    }
  } catch (error) {
    console.error('Error validating NFT contract:', error);
    return { 
      valid: false, 
      reason: `Validation error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
};

/**
 * Gets additional information about an NFT contract
 */
export const getNFTContractInfo = async (
  contractAddress: string, 
  provider: ethers.Provider
): Promise<{ name?: string; symbol?: string; totalSupply?: bigint }> => {
  try {
    const contract = new ethers.Contract(
      contractAddress,
      [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function totalSupply() view returns (uint256)'
      ],
      provider
    );
    
    // Use Promise.allSettled to handle failures gracefully
    const [nameResult, symbolResult, supplyResult] = await Promise.allSettled([
      contract.name(),
      contract.symbol(),
      contract.totalSupply()
    ]);
    
    // Extract values or set undefined if rejected
    const name = nameResult.status === 'fulfilled' ? nameResult.value : undefined;
    const symbol = symbolResult.status === 'fulfilled' ? symbolResult.value : undefined;
    const totalSupply = supplyResult.status === 'fulfilled' ? supplyResult.value : undefined;
    
    return { name, symbol, totalSupply };
  } catch (error) {
    console.error('Error getting NFT contract info:', error);
    return {};
  }
};

/**
 * Detects the mint function for an NFT contract
 */
export const detectMintFunction = async (
  contractAddress: string, 
  provider: ethers.Provider
): Promise<string | null> => {
  const mintFunctions = [
    'function mint(uint256)',
    'function mint(address,uint256)',
    'function publicMint(uint256)',
    'function publicMint(address,uint256)',
    'function mintPublic(uint256)',
    'function mintPublic(address,uint256)'
  ];
  
  try {
    for (const func of mintFunctions) {
      const functionName = func.split('(')[0].replace('function ', '');
      
      const contract = new ethers.Contract(
        contractAddress,
        [func],
        provider
      );
      
      try {
        // Just check if the function exists
        const funcFragment = contract.interface.getFunction(functionName);
        if (funcFragment) {
          return func;
        }
      } catch {
        // Function doesn't exist in the contract
        continue;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error detecting mint function:', error);
    return null;
  }
}; 