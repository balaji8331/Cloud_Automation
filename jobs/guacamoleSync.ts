import prisma from "@/lib/db";
import { getGuacamoleClient } from "@/lib/guacamole/db";

export async function processGuacamoleSync() {
  const pool = getGuacamoleClient();
  let client;
  
  try {
    client = await pool.connect();
  } catch (error: any) {
    console.error(`[GuacamoleSync] Connection failed — tunnel may be down. ${error.message}`);
    return;
  }

  try {
    const result = await client.query(`
      SELECT 
        gc.connection_name,
        gcp.parameter_value AS hostname,
        ge.name AS username
      FROM guacamole_connection gc
      JOIN guacamole_connection_parameter gcp 
        ON gcp.connection_id = gc.connection_id 
        AND gcp.parameter_name = 'hostname'
      JOIN guacamole_connection_permission gcperm 
        ON gcperm.connection_id = gc.connection_id
      JOIN guacamole_entity ge 
        ON ge.entity_id = gcperm.entity_id 
        AND ge.type = 'USER'
      WHERE gcperm.permission = 'READ'
    `);

    const rows = result.rows; 
    
    const vms = await prisma.vmInventoryItem.findMany({
      select: { id: true, ipAddress: true }
    });

    const vmByIp = new Map(vms.map(vm => [vm.ipAddress, vm.id]));
    
    let matchedCount = 0;
    let upsertedCount = 0;
    const now = new Date();

    for (const row of rows) {
      const vmId = vmByIp.get(row.hostname);
      if (vmId) {
        matchedCount++;
        await prisma.guacamoleAccessSync.upsert({
          where: {
            vmInventoryItemId_guacamoleUsername: {
              vmInventoryItemId: vmId,
              guacamoleUsername: row.username
            }
          },
          update: {
            guacamoleConnectionName: row.connection_name,
            lastSyncedAt: now
          },
          create: {
            vmInventoryItemId: vmId,
            guacamoleUsername: row.username,
            guacamoleConnectionName: row.connection_name,
            lastSyncedAt: now
          }
        });
        upsertedCount++;
      }
    }

    const deleteResult = await prisma.guacamoleAccessSync.deleteMany({
      where: {
        lastSyncedAt: { lt: now }
      }
    });

    console.log(`[GuacamoleSync] Sync complete: ${rows.length} connections read, ${matchedCount} matched, ${upsertedCount} updated/added, ${deleteResult.count} stale removed.`);
  } catch (error: any) {
    console.error(`[GuacamoleSync] Error during sync query: ${error.message}`);
  } finally {
    client.release();
  }
}
