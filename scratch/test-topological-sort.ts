import assert from "assert";

const TYPE_DEPENDENCY_GRAPH: [string, string][] = [
  // [deleteFirst, deleteAfter]
  ["microsoft.compute/virtualmachines", "microsoft.compute/disks"],
  ["microsoft.compute/virtualmachines", "microsoft.network/networkinterfaces"],
  ["microsoft.network/networkinterfaces", "microsoft.network/publicipaddresses"],
  ["microsoft.network/networkinterfaces", "microsoft.network/virtualnetworks"],
  ["microsoft.network/networkinterfaces", "microsoft.network/networksecuritygroups"],
  ["microsoft.network/virtualnetworks", "microsoft.network/networksecuritygroups"],
  ["microsoft.web/sites", "microsoft.web/serverfarms"],
  ["microsoft.compute/virtualmachines/extensions", "microsoft.compute/virtualmachines"],
];

function buildTypeRanks(): Record<string, number> {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const [first, after] of TYPE_DEPENDENCY_GRAPH) {
    if (!graph.has(first)) graph.set(first, []);
    if (!graph.has(after)) graph.set(after, []);
    if (!inDegree.has(first)) inDegree.set(first, 0);
    if (!inDegree.has(after)) inDegree.set(after, 0);
  }

  for (const [first, after] of TYPE_DEPENDENCY_GRAPH) {
    graph.get(first)!.push(after);
    inDegree.set(after, inDegree.get(after)! + 1);
  }

  const ranks: Record<string, number> = {};
  const queue: string[] = [];
  let currentRank = 0;

  for (const [node, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(node);
  }

  while (queue.length > 0) {
    const size = queue.length;
    for (let i = 0; i < size; i++) {
      const node = queue.shift()!;
      ranks[node] = currentRank;
      for (const neighbor of graph.get(node)!) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }
    currentRank++;
  }

  return ranks;
}

const typeRanks = buildTypeRanks();
console.log("Computed Type Ranks:", typeRanks);

// Basic ARM path depth priority for unmapped resources
const PARENT_TYPE_PRIORITY: Record<string, number> = {
  "microsoft.cognitiveservices/accounts": 0,
  "microsoft.cognitiveservices/accounts/projects": 100,
};

function sortResourcesForDeletion(resources: any[]): any[] {
  return [...resources].sort((a, b) => {
    const typeA = a.type.toLowerCase();
    const typeB = b.type.toLowerCase();

    const getRank = (t: string) => {
      if (typeRanks[t] !== undefined) return typeRanks[t];
      const parts = t.split("/");
      if (parts.length > 2) {
        const base = parts.slice(0, 2).join("/");
        return typeRanks[base];
      }
      return undefined;
    };

    const rankA = getRank(typeA);
    const rankB = getRank(typeB);

    // 1. Topological Sort Rank (lower rank = delete earlier)
    if (rankA !== undefined && rankB !== undefined) {
      if (rankA !== rankB) return rankA - rankB;
    } else if (rankA !== undefined && rankB === undefined) {
      return -1; // ranked types come before unranked
    } else if (rankA === undefined && rankB !== undefined) {
      return 1;
    }

    // 2. ARM path depth (existing logic)
    const typeDepthA = typeA.split("/").length;
    const typeDepthB = typeB.split("/").length;
    if (typeDepthA !== typeDepthB) return typeDepthB - typeDepthA; // Deepest first

    const idDepthA = a.id.split("/").length;
    const idDepthB = b.id.split("/").length;
    if (idDepthA !== idDepthB) return idDepthB - idDepthA; // Deepest first

    // 3. Fallback Priority
    const prioA = PARENT_TYPE_PRIORITY[typeA] ?? 50;
    const prioB = PARENT_TYPE_PRIORITY[typeB] ?? 50;
    if (prioA !== prioB) return prioB - prioA; // Higher prio first

    return typeA.localeCompare(typeB);
  });
}

function shuffle(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function runTests() {
  const mockResources = [
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.compute/virtualmachines/vm1", type: "microsoft.compute/virtualmachines", name: "vm1" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.compute/virtualmachines/vm2", type: "microsoft.compute/virtualmachines", name: "vm2" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.compute/disks/disk1", type: "microsoft.compute/disks", name: "disk1" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.compute/disks/disk2", type: "microsoft.compute/disks", name: "disk2" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.network/networkinterfaces/nic1", type: "microsoft.network/networkinterfaces", name: "nic1" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.network/networkinterfaces/nic2", type: "microsoft.network/networkinterfaces", name: "nic2" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.network/publicipaddresses/pip1", type: "microsoft.network/publicipaddresses", name: "pip1" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.network/virtualnetworks/vnet1", type: "microsoft.network/virtualnetworks", name: "vnet1" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.network/virtualnetworks/vnet1/subnets/sub1", type: "microsoft.network/virtualnetworks/subnets", name: "sub1" },
    { id: "/subscriptions/1/resourceGroups/rg1/providers/microsoft.network/networksecuritygroups/nsg1", type: "microsoft.network/networksecuritygroups", name: "nsg1" },
  ];

  // Randomize 10 times to ensure sort is stable regardless of input order
  for (let i = 0; i < 10; i++) {
    shuffle(mockResources);
    const sorted = sortResourcesForDeletion(mockResources);

    const getIndices = (typePrefix: string) => 
      sorted.map((r, idx) => r.type.includes(typePrefix) ? idx : -1).filter(i => i !== -1);
    const getIndex = (typePrefix: string) => getIndices(typePrefix)[0]; // for singletons

    const vmIndices = getIndices("virtualmachines");
    const diskIndices = getIndices("disks");
    const nicIndices = getIndices("networkinterfaces");
    const ipIndices = getIndices("publicipaddresses");
    const vnetIndices = getIndices("virtualnetworks"); // This includes subnets due to includes() if not careful, let's use exact match or know subnets
    const nsgIndices = getIndices("networksecuritygroups");

    // Assert VMs come before Disks and NICs
    for (const vmIdx of vmIndices) {
      for (const diskIdx of diskIndices) assert(vmIdx < diskIdx, "VM must come before Disk");
      for (const nicIdx of nicIndices) assert(vmIdx < nicIdx, "VM must come before NIC");
    }

    // Assert NICs come before IPs, VNets, NSGs
    for (const nicIdx of nicIndices) {
      for (const ipIdx of ipIndices) assert(nicIdx < ipIdx, "NIC must come before IP");
      for (const vnetIdx of vnetIndices) assert(nicIdx < vnetIdx, "NIC must come before VNet/Subnets");
      for (const nsgIdx of nsgIndices) assert(nicIdx < nsgIdx, "NIC must come before NSG");
    }

    // Assert VNets come before NSGs
    for (const vnetIdx of vnetIndices) {
      for (const nsgIdx of nsgIndices) assert(vnetIdx < nsgIdx, "VNet must come before NSG");
    }
  }
  
  console.log("Topological sort test passed 10 iterations with shuffled inputs!");
}

runTests().catch(console.error);
