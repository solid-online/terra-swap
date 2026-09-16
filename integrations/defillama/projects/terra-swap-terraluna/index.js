const { getFactoryTvl } = require('../terraswap/factoryTvl')

// Terra Swap's own factory on Terra (swap.openfields.app). No owner, no admin, no protocol fee.
const factory = 'terra1gx7n4yrfc2req7tdt9vpj66kr0cssnqkjsr80xmfacjpdlw6mzlqvlp3xd'

module.exports = {
  timetravel: false,
  misrepresentedTokens: true,
  methodology: "Tokens in the pools of Terra Swap's own factory on Terra. Pools on Astroport that the site also routes through are not counted.",
  terra2: { tvl: getFactoryTvl(factory) },
}
