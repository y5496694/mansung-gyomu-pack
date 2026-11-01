'use strict';
const portal=require('./portal-login.cjs');
const registry=require('../vendor/narae-gyomu/packages/narae_gyomoo_portal/skills/narae-gyomu-work-portal/scripts/regions.cjs');
function state(home){const cfg=portal.config(home);return {region:cfg.region,id:cfg.id,portalUrl:cfg.portalUrl,regions:registry.regions.map(({id,region,label,portalUrl,liveTested})=>({id,region,label,portalUrl,liveTested}))};}
function configure(home,region){portal.configure(home,{region});return state(home);}
module.exports={state,configure,...registry};
