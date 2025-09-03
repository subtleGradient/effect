import * as LibCrSql from "@effect-native/libcrsql"
import { Reactivity } from "@effect/experimental"
import { FileSystem } from "@effect/platform"
import { NodeFileSystem } from "@effect/platform-node"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

const makeClient = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const dir = yield* fs.makeTempDirectoryScoped()
  return yield* SqliteClient.make({
    filename: dir + "/test.db"
  })
}).pipe(Effect.provide([NodeFileSystem.layer, Reactivity.layer]))

describe("Client", () => {
  it.scoped("should work", () =>
    Effect.gen(function*() {
      const sql = yield* makeClient
      let response
      response = yield* sql`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`
      assert.deepStrictEqual(response, [])
      response = yield* sql`INSERT INTO test (name) VALUES ('hello')`
      assert.deepStrictEqual(response, [])
      response = yield* sql`SELECT * FROM test`
      assert.deepStrictEqual(response, [{ id: 1, name: "hello" }])
      response = yield* sql`INSERT INTO test (name) VALUES ('world')`.pipe(sql.withTransaction)
      assert.deepStrictEqual(response, [])
      response = yield* sql`SELECT * FROM test`
      assert.deepStrictEqual(response, [
        { id: 1, name: "hello" },
        { id: 2, name: "world" }
      ])
    }))

  it.scoped("should work with raw", () =>
    Effect.gen(function*() {
      const sql = yield* makeClient
      let response
      response = yield* sql`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`.raw
      assert.deepStrictEqual(response, { changes: 0, lastInsertRowid: 0 })
      response = yield* sql`INSERT INTO test (name) VALUES ('hello')`.raw
      assert.deepStrictEqual(response, { changes: 1, lastInsertRowid: 1 })
      response = yield* sql`SELECT * FROM test`.raw
      assert.deepStrictEqual(response, [{ id: 1, name: "hello" }])
      response = yield* sql`INSERT INTO test (name) VALUES ('world')`.raw.pipe(sql.withTransaction)
      assert.deepStrictEqual(response, { changes: 1, lastInsertRowid: 2 })
      response = yield* sql`SELECT * FROM test`
      assert.deepStrictEqual(response, [
        { id: 1, name: "hello" },
        { id: 2, name: "world" }
      ])
    }))

  it.scoped("withTransaction", () =>
    Effect.gen(function*() {
      const sql = yield* makeClient
      yield* sql`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`
      yield* sql.withTransaction(sql`INSERT INTO test (name) VALUES ('hello')`)
      const rows = yield* sql`SELECT * FROM test`
      assert.deepStrictEqual(rows, [{ id: 1, name: "hello" }])
    }))

  it.scoped("withTransaction rollback", () =>
    Effect.gen(function*() {
      const sql = yield* makeClient
      yield* sql`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`
      yield* sql`INSERT INTO test (name) VALUES ('hello')`.pipe(
        Effect.andThen(Effect.fail("boom")),
        sql.withTransaction,
        Effect.ignore
      )
      const rows = yield* sql`SELECT * FROM test`
      assert.deepStrictEqual(rows, [])
    }))

  it.scoped("loadExtension (crsqlite)", () =>
    Effect.gen(function*() {
      const sql = yield* makeClient
      // Ensure a crsqlite function errors before extension is loaded
      const beforeErr = yield* sql`SELECT crsql_sha()`.pipe(Effect.flip)
      assert.equal(beforeErr._tag, "SqlError")

      const extPath = yield* Effect.try(() => LibCrSql.getCrSqliteExtensionPathSync())
      yield* sql.loadExtension(extPath)

      // Use a different query after loading to avoid prepared statement cache issues
      const rows = yield* sql<
        { sha: string; site_id: string }
      >`SELECT crsql_sha() as sha, hex(crsql_site_id()) AS site_id`
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(typeof rows[0].site_id, "string")
      assert(rows[0].site_id.length > 0)
    }))
})
