import sqlite3 from 'sqlite3'
import logger from 'winston'

const CREATE_TX_QUEUE = `CREATE TABLE watch_tx_with_tx_queue (
 queue_ix INTEGER PRIMARY KEY,
 toWatchTxHash TEXT NOT NULL,
 toBroadcastHex TEXT NOT NULL,
 confirmations INTEGER DEFAULT 4,
 received_ts DATETIME DEFAULT CURRENT_TIMESTAMP
);`

const CREATE_ZF_QUEUE = `CREATE TABLE watch_tx_with_zf_queue (
 queue_ix INTEGER PRIMARY KEY,
 toWatchTxHash TEXT NOT NULL,
 toBroadcastZF TEXT NOT NULL,
 confirmations INTEGER DEFAULT 7,
 received_ts DATETIME DEFAULT CURRENT_TIMESTAMP
);`

const CREATE_ZONEFILES_BACKUPS = `CREATE TABLE zonefile_backups (
 backup_ix INTEGER PRIMARY KEY,
 zonefile TEXT NOT NULL,
 timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);`

const CREATE_TRANSACTIONS_BACKUPS = `CREATE TABLE tx_backups (
 backup_ix INTEGER PRIMARY KEY,
 zonefile TEXT NOT NULL,
 timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);`


function dbRun(db: Object, cmd: String, args?: Array) {
  if (!args) {
    args = []
  }
  return new Promise((resolve, reject) => {
    db.run(cmd, args, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

function dbAll(db: Object, cmd: String, args?: Array) {
  if (!args) {
    args = []
  }
  return new Promise((resolve, reject) => {
    db.all(cmd, args, (err, rows) => {
      if (err) {
        reject(err)
      } else {
        resolve(rows)
      }
    })
  })
}

export class TransactionQueueDB {
  constructor(dbLocation: String) {
    this.dbLocation = dbLocation
  }

  initialize() {
      return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbLocation, sqlite3.OPEN_READWRITE, (errOpen) => {
        if (errOpen) {
          logger.warn(`No database found ${this.dbLocation}, creating`)
          this.db = new sqlite3.Database(
            this.dbLocation, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (errCreate) => {
              if (errCreate) {
                reject(`Failed to load database ${this.dbLocation}`)
              } else {
                logger.warn('Creating tables...')
                this.createTables()
                  .then(() => resolve())
              }
            })
        } else {
          this.tablesExist()
            .then( exist => {
              if (exist) {
                return Promise.resolve()
              } else {
                return this.createTables()
              }
            })
            .then(() => resolve())
        }
      })
    })
  }

  tablesExist() {
    return dbAll(this.db, 'SELECT name FROM sqlite_master WHERE type = "table"')
      .then( results => {
        const tables = results.map( x => x.name )
        return tables.indexOf('watch_tx_with_zf_queue') >= 0 &&
          tables.indexOf('watch_tx_with_tx_queue') >= 0 &&
          tables.indexOf('tx_backups') >= 0
          tables.indexOf('zonefiles_backups') >= 0
      })
  }

  createTables() {
    const toCreate = [CREATE_TX_QUEUE, CREATE_TRANSACTIONS_BACKUPS,
                      CREATE_ZONEFILES_BACKUPS, CREATE_ZF_QUEUE]
    let creationPromise = Promise.resolve()
    toCreate.forEach((createCmd) => {
      creationPromise = creationPromise.then(() => dbRun(this.db, createCmd))
    })
    return creationPromise
  }

  queueTransactionToBroadcast(toBroadcast, txidToWatch, confirmations) {
    const cmd = `INSERT INTO watch_tx_with_tx_queue (toBroadcastHex, toWatchTxHash, confirmations)
                  VALUES (?, ?, ?)`
    const args = [toBroadcast, txidToWatch, confirmations]
    return dbRun(this.db, cmd, args)
  }

  queueZoneFileBroadcast(zoneFile, txidToWatch) {
    const cmd = `INSERT INTO watch_tx_with_zf_queue (toBroadcastZF, toWatchTxHash)
                  VALUES (?, ?)`
    const args = [zoneFile, txidToWatch]
    return dbRun(this.db, cmd, args)
  }

  getTrackedTransactions() {
    const txCmd = 'SELECT * FROM watch_tx_with_tx_queue'
    const zfCmd = 'SELECT * FROM watch_tx_with_zf_queue'

    return Promise.all([dbAll(this.db, txCmd), dbAll(this.db, zfCmd)])
      .then(([transactionWatching, zoneFileWatching]) => {
        const results = []
        transactionWatching.forEach(record => {
          results.push({
            type: 'transaction',
            transaction: record.toBroadcastHex,
            txToWatch: record.toWatchTxHash,
            confirmations: record.confirmations
          })
        })
        zoneFileWatching.forEach(record => {
          results.push({
            type: 'zoneFile',
            zoneFile: record.toBroadcastZF,
            txToWatch: record.toWatchTxHash,
            confirmations: record.confirmations
          })
        })
        return results
      })
  }

  clearWatchedTransaction(entry: {type: String, txToWatch: String}) {
    let table
    if (entry.type === 'transaction') {
      table = 'watch_tx_with_tx_queue'
    } else if (entry.type === 'zoneFile') {
      table = 'watch_tx_with_zf_queue'
    } else {
      throw new Error(`Unknown tracking type: ${entry.type}`)
    }
    const cmd = `DELETE FROM ${table} WHERE toWatchTxHash = ?`
    const args = [entry.txToWatch]
    return dbRun(this.db, cmd, args)
  }
}
