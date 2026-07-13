export const proxy: {
  enable: boolean
  host: string
  port: string

  envProxy?: {
    host: string
    port: string
  }
} = {
  enable: false,
  host: '',
  port: '',
}
