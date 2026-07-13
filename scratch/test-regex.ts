import assert from "assert";

function extractNames(errorMessage: string): Set<string> {
  const quoted = errorMessage.match(/'([^']+)'/g) ?? [];
  const names = new Set<string>();
  for (const q of quoted) {
    const lastSegment = q.slice(1, -1).split("/").pop();
    if (lastSegment) names.add(lastSegment.toLowerCase());
  }
  return names;
}

const tests = [
  { msg: "nested resource 'child1' cannot be deleted", expected: "child1" },
  { msg: "Resource 'some-db' is in use by another resource", expected: "some-db" },
  { msg: "must be disassociated from 'nsg-1' before", expected: "nsg-1" },
  { msg: "cannot delete because it is referenced by 'nic-123'", expected: "nic-123" },
  { msg: "Subnet 'frontend-sub' requires NSG to be detached", expected: "frontend-sub" },
  { msg: "Cannot delete vault since it contains 'my-key-1'", expected: "my-key-1" }
];

let allPassed = true;
for (const t of tests) {
  const names = extractNames(t.msg);
  if (!names.has(t.expected.toLowerCase())) {
    console.error(`Failed on: "${t.msg}". Expected to extract "${t.expected}", but got:`, Array.from(names));
    allPassed = false;
  }
}

if (allPassed) {
  console.log("Regex extraction test passed for all Azure error variations!");
}
