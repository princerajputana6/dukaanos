import { getTableName, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Table-qualified column reference for correlated subqueries. In single-table selects Drizzle
 * renders `${table.id}` as a bare "id", which inside `(select … from other o where o.x = "id")`
 * silently binds to the INNER table's id. Always use `ref()` in correlated subqueries.
 */
export function ref(col: AnySQLiteColumn): SQL {
  return sql.raw(`"${getTableName(col.table)}"."${col.name}"`);
}
