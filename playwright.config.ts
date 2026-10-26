import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',workers:1,use:{baseURL:'http://localhost:3000',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']},screenshot:'only-on-failure'},webServer:{command:'npm start',url:'http://localhost:3000',reuseExistingServer:false,timeout:90000}});
