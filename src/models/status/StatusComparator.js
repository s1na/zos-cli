import { App } from 'zos-lib'
import StatusReport from './StatusReport'
import EventsFilter from './EventsFilter'
import { bytecodeDigest } from '../../utils/contracts'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export default class StatusComparator {
  constructor(networkFile, txParams = {}) {
    this.reports = []
    this.txParams = txParams
    this.networkFile = networkFile
  }

  async call() {
    await this.checkVersion()
    await this.checkProvider()
    await this.checkStdlib()
    await this.checkImplementations()
    await this.checkProxies()
    return this.reports
  }

  async checkVersion() {
    const observed = (await this.app()).version
    const expected = this.networkFile.version
    if(observed !== expected) this._addReport(expected, observed, 'App version does not match')
  }

  async checkProvider() {
    const observed = (await this.app()).currentDirectory().address
    const expected = this.networkFile.providerAddress
    if(observed !== expected) this._addReport(expected, observed, 'Provider address does not match')
  }

  async checkStdlib() {
    const app = await this.app();
    const currentStdlib = await app.currentStdlib();
    const observed = currentStdlib === ZERO_ADDRESS ? 'none' : currentStdlib
    const expected = this.networkFile.stdlibAddress || 'none'
    if(observed !== expected) this._addReport(expected, observed, 'Stdlib address does not match')
  }

  async checkImplementations() {
    const implementationsInfo = await this._fetchOnChainImplementations()
    implementationsInfo.forEach(info => this.checkImplementation(info))
    const foundAliases = implementationsInfo.map(info => info.alias)
    this.networkFile.contractAliases
      .filter(alias => !foundAliases.includes(alias))
      .forEach(alias => this._addReport(alias, 'none', 'Contract does not match'))
  }

  checkImplementation({ alias, implementation }) {
    if (this.networkFile.hasContract(alias)) {
      this._checkImplementationAddress(alias, implementation)
      this._checkImplementationBytecode(alias, implementation)
    }
    else this._addReport('none', alias, 'Contract does not match')
  }

  async checkProxies() {
    const proxiesInfo = await this._fetchOnChainProxiesInfo()
    proxiesInfo.forEach(info => this.checkProxy(info))
    const foundAliases = proxiesInfo.map(info => info.alias)
    this.networkFile.proxyAliases
      .filter(alias => !foundAliases.includes(alias))
      .forEach(alias => {
        const proxies = this.networkFile.proxy(alias)
        proxies.forEach(proxy => this._addReport(1, 0, `Proxy of ${alias} at ${proxy.address} pointing to ${proxy.implementation} does not match`))
      })
  }

  checkProxy({ alias, address, implementation}) {
    if (this.networkFile.hasProxy(alias)) {
      let matchingFound = false
      const proxies = this.networkFile.proxy(alias)
      proxies.forEach(proxy => {
        const expectedAddress = proxy.address
        if (expectedAddress !== address && !matchingFound) this._addReport(expectedAddress, address, `Proxy of ${alias} at ${expectedAddress} pointing to ${proxy.implementation} does not match`)
        else {
          const expectedImplementation = proxy.implementation
          if (expectedImplementation === implementation) matchingFound = true
          else this._addReport(expectedImplementation, implementation, `Proxy of ${alias} at ${expectedAddress} does not pointing to ${implementation} does not match`)
        }
      })
    }
    else this._addReport('none', alias, 'Proxy does not match')
  }

  _checkImplementationAddress(alias, address) {
    const expected = this.networkFile.contract(alias).address
    if (address !== expected) this._addReport(expected, address, `Address for contract ${alias} does not match`)
  }

  _checkImplementationBytecode(alias, address) {
    if(this.networkFile.contract(alias).address !== address) return;
    const constructorCode = this.networkFile.contract(alias).constructorCode
    const expected = this.networkFile.contract(alias).bytecodeHash
    const bodyBytecode = web3.eth.getCode(address).replace(/^0x/, '');
    const observed = bytecodeDigest(constructorCode + bodyBytecode)
    if (observed !== expected) this._addReport(expected, observed, `Bytecode at ${address} for contract ${alias} does not match`)
  }

  async _fetchOnChainImplementations() {
    const app = await this.app();
    const filter = new EventsFilter();
    const allEvents = await filter.call(app.currentDirectory(), 'ImplementationChanged')
    const contractsAlias = allEvents.map(event => event.args.contractName)
    return allEvents
      .filter((event, index) => contractsAlias.lastIndexOf(event.args.contractName) === index)
      .filter(event => event.args.implementation !== ZERO_ADDRESS)
      .map(event => ({ alias: event.args.contractName, implementation: event.args.implementation }))
  }

  async _fetchOnChainProxiesInfo() {
    const implementationsInfo = await this._fetchOnChainImplementations()
    const app = await this.app();
    const filter = new EventsFilter()
    const proxyEvents = await filter.call(app.factory, 'ProxyCreated')
    const proxiesInfo = []
    await Promise.all(proxyEvents.map(async event => {
      const proxyAddress = event.args.proxy
      const implementation = await app.getProxyImplementation(proxyAddress)
      const matchingImplementations = implementationsInfo.filter(info => info.implementation === implementation)
      if (matchingImplementations.length > 1) {
        this._addReport(1, matchingImplementations.length, `The same implementation address ${implementation} was registered under many aliases`)
      } else if (matchingImplementations.length === 0) {
        this._addReport(1, 0, `Proxy at ${proxyAddress} is pointing to ${implementation} but given implementation is not registered in app`)
      } else {
        const alias = matchingImplementations[0].alias
        proxiesInfo.push({ alias, implementation, address: proxyAddress })
      }
    }))
    return proxiesInfo;
  }

  _addReport(expected, observed, description) {
    const report = new StatusReport(expected, observed, description);
    this.reports.push(report)
  }

  async app() {
    if(!this._app) this._app = await App.fetch(this.networkFile.appAddress, this.txParams)
    return this._app
  }
}