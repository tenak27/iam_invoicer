// Serveur de l'entreprise : le poste (ou le serveur) qui détient la base la partage sur le
// réseau local. Les autres ordinateurs, tablettes et téléphones de l'entreprise s'y connectent
// par son adresse (http://192.168.x.x:8080) : application de bureau en mode « serveur », ou
// simple navigateur. Aucune installation de PostgreSQL ni de Docker : l'application suffit,
// tant qu'elle reste ouverte sur ce poste.
// La base peut en plus être recopiée vers sa copie en ligne (mirror.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { createHandler } from '../server/app'
import type { Db } from './db'
import { MirrorLoop, type MirrorState } from './mirror'

export interface EnterpriseConfig {
  /** Partager la base de ce poste sur le réseau local. */
  serve: boolean
  port: number
  /** Copie en ligne : adresse de la base hébergée et clé de synchronisation. */
  cloudUrl: string
  cloudKey: string
  cloudMinutes: number
}

export const DEFAULT_ENTERPRISE: EnterpriseConfig = { serve: false, port: 8080, cloudUrl: '', cloudKey: '', cloudMinutes: 15 }

export function readEnterpriseConfig(path: string): EnterpriseConfig {
  try {
    return { ...DEFAULT_ENTERPRISE, ...JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    return { ...DEFAULT_ENTERPRISE }
  }
}

export function writeEnterpriseConfig(path: string, cfg: EnterpriseConfig) {
  writeFileSync(path, JSON.stringify(cfg, null, 2))
}

export interface EnterpriseState {
  serve: boolean
  listening: boolean
  port: number
  /** Adresses à saisir sur les autres postes. */
  addresses: string[]
  error: string | null
  cloudUrl: string
  hasCloudKey: boolean
  cloudMinutes: number
  mirror: MirrorState
}

/** Adresses IPv4 de ce poste sur le réseau local. */
export function lanAddresses(port: number): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`)
  return out
}

export class Enterprise {
  private server: Server | null = null
  private error: string | null = null
  private cfg: EnterpriseConfig
  readonly mirror: MirrorLoop

  constructor(private opts: { configPath: string; db: () => Db | null; version: string; webRoot: string; onChange?: () => void }) {
    this.cfg = readEnterpriseConfig(opts.configPath)
    this.mirror = new MirrorLoop(opts.db, opts.onChange)
  }

  state(): EnterpriseState {
    return {
      serve: this.cfg.serve, listening: !!this.server?.listening, port: this.cfg.port, addresses: this.server?.listening ? lanAddresses(this.cfg.port) : [], error: this.error,
      cloudUrl: this.cfg.cloudUrl, hasCloudKey: !!this.cfg.cloudKey, cloudMinutes: this.cfg.cloudMinutes, mirror: this.mirror.state()
    }
  }

  /** À l'ouverture de la base : démarre ce qui est activé. */
  async start() {
    await this.listen()
    this.mirror.configure({ url: this.cfg.cloudUrl, key: this.cfg.cloudKey, minutes: this.cfg.cloudMinutes })
  }

  async save(input: Partial<EnterpriseConfig>): Promise<EnterpriseState> {
    const port = Number(input.port ?? this.cfg.port)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port invalide : choisissez un nombre entre 1024 et 65535 (8080 par défaut).')
    this.cfg = {
      serve: input.serve ?? this.cfg.serve,
      port,
      cloudUrl: String(input.cloudUrl ?? this.cfg.cloudUrl).trim(),
      // Clé vide : on garde celle déjà enregistrée
      cloudKey: String(input.cloudKey ?? '').trim() || this.cfg.cloudKey,
      cloudMinutes: Math.min(1440, Math.max(1, Number(input.cloudMinutes ?? this.cfg.cloudMinutes) || 15))
    }
    if (!this.cfg.cloudUrl) this.cfg.cloudKey = ''
    writeEnterpriseConfig(this.opts.configPath, this.cfg)
    await this.listen()
    this.mirror.configure({ url: this.cfg.cloudUrl, key: this.cfg.cloudKey, minutes: this.cfg.cloudMinutes })
    return this.state()
  }

  pushNow() {
    return this.mirror.push(this.cfg.cloudUrl, this.cfg.cloudKey, true)
  }

  private async listen() {
    await this.close()
    this.error = null
    const db = this.opts.db()
    if (!this.cfg.serve || !db) return
    if (!existsSync(this.opts.webRoot)) {
      this.error = "Fichiers de l'application web introuvables sur ce poste."
      return
    }
    const server = createServer(createHandler({ db, version: this.opts.version, webRoot: this.opts.webRoot }))
    await new Promise<void>((resolve) => {
      server.once('error', (e: any) => {
        this.error = e?.code === 'EADDRINUSE' ? `Le port ${this.cfg.port} est déjà utilisé par un autre programme : choisissez-en un autre.` : `Démarrage du serveur impossible : ${e?.message ?? e}`
        resolve()
      })
      server.listen(this.cfg.port, '0.0.0.0', () => {
        this.server = server
        resolve()
      })
    })
    this.opts.onChange?.()
  }

  async close() {
    const s = this.server
    this.server = null
    if (s) await new Promise<void>((r) => s.close(() => r()))
  }

  async stop() {
    this.mirror.stop()
    await this.close()
  }
}
