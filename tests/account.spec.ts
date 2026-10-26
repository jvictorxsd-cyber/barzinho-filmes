import {test,expect} from '@playwright/test';
test('cadastro, sessão persistente, conquistas e navegação mobile',async({page})=>{
 const id=Date.now().toString();
 try {
 await page.goto('/cadastro');
 await expect(page.locator('.auth-card form')).toHaveAttribute('method','post');
 await page.getByLabel('Como podemos te chamar?').fill('Teste navegador');
 await page.getByLabel(/Nome de usuário/).fill(`e2e_${id}`);
 await page.getByLabel('E-mail',{exact:true}).fill(`e2e_${id}@example.invalid`);
 await page.getByLabel('Senha',{exact:true}).fill('Senha-teste-segura-123');
 await page.getByRole('button',{name:'Criar minha conta',exact:true}).click();
 await expect(page).toHaveURL('http://localhost:3000/');
 await page.reload();
 await page.goto('/perfil');
 await expect(page.getByRole('heading',{name:'Teste navegador'})).toBeVisible();
 await page.getByText('Perfil, privacidade e sessões',{exact:true}).click();
 await page.getByLabel('Nome de exibição',{exact:true}).fill('Perfil atualizado');
 await page.getByLabel('Biografia',{exact:true}).fill('Minha história de cinema');
 await page.getByLabel('Perfil privado',{exact:true}).check();
 await page.getByRole('button',{name:'Salvar perfil',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Perfil atualizado'})).toBeVisible();
 await page.reload();
 await page.getByText('Perfil, privacidade e sessões',{exact:true}).click();
 await expect(page.getByLabel('Perfil privado',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Biografia',{exact:true})).toHaveValue('Minha história de cinema');
 await page.goto('/conquistas');
 await expect(page.getByRole('heading',{name:'Primeira Sessão',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await expect(page.getByRole('navigation',{name:'Navegação mobile'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/barzinho-mobile.png',fullPage:true});
 } finally {
 // Clean this test's exact account even when a browser assertion fails.
 const login=await page.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:{email:`e2e_${id}@example.invalid`,password:'Senha-teste-segura-123'}});
 if(login.ok()) {
  const response=await page.request.delete('/api/account',{headers:{Origin:'http://localhost:3000'},data:{password:'Senha-teste-segura-123'}});
  expect(response.ok()).toBe(true);
 }
 }
});
test('tema claro e navegação por filtro do catálogo',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Ativar tema claro'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('button',{name:'Ativar tema escuro'}).click();
 await page.screenshot({path:'/tmp/barzinho-desktop.png',fullPage:true});
 await page.goto('/explorar?type=tv');
 await expect(page.getByRole('button',{name:'Séries',exact:true})).toHaveClass(/active/);
});

test('listas persistem nome e privacidade; agenda alterna semana e mês',async({page,browser})=>{
 const id=Date.now().toString();const email=`e2e_lists_${id}@example.invalid`;const password='Senha-listas-teste-123';
 const anon=await browser.newContext();
 try{
  const registered=await page.request.post('/api/auth/register',{headers:{Origin:'http://localhost:3000'},data:{email,password,username:`lists_${id}`,displayName:'Teste de listas'}});
  expect(registered.status()).toBe(201);
  await page.goto('/listas');
  await page.getByText('Criar uma lista',{exact:true}).click();
  await page.getByLabel('Nome da lista',{exact:true}).fill('Sessões de domingo');
  await page.getByRole('button',{name:'Criar lista',exact:true}).click();
  await expect(page).toHaveURL(/\/listas\/[a-f0-9-]+$/);
  const listId=page.url().split('/').pop();
  await expect(page.getByRole('heading',{name:'Sessões de domingo',exact:true})).toBeVisible();
  expect((await anon.request.get(`http://localhost:3000/api/lists/${listId}`)).status()).toBe(404);
  await page.getByText('Editar nome e privacidade',{exact:true}).click();
  await page.getByLabel('Nome da lista',{exact:true}).fill('Clube do domingo');
  await page.getByLabel('Lista privada',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Salvar lista',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Clube do domingo',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Clube do domingo',exact:true})).toBeVisible();
  expect((await anon.request.get(`http://localhost:3000/api/lists/${listId}`)).status()).toBe(200);
  await page.goto('/calendario');
  await page.getByRole('button',{name:'Semana',exact:true}).click();
  await expect(page.locator('.schedule-grid.week .calendar-cell')).toHaveCount(7);
  await page.locator('.followed-schedule').getByRole('button',{name:'Mês',exact:true}).click();
  await expect(page.locator('.schedule-grid.month')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goto(`/listas/${listId}`);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Excluir lista',exact:true}).click();
  await expect(page).toHaveURL('http://localhost:3000/listas');
  expect((await page.request.get(`/api/lists/${listId}`)).status()).toBe(404);
  await page.goto('/perfil');
  await page.getByText('Perfil, privacidade e sessões',{exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Encerrar todas as sessões',exact:true}).click();
  await expect(page).toHaveURL('http://localhost:3000/entrar');
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
 }finally{
  await page.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:{email,password}});
  await page.request.delete('/api/account',{headers:{Origin:'http://localhost:3000'},data:{password}});
  await anon.close();
 }
});

test('recuperação informa indisponibilidade; links de conta removem tokens da URL e recusam tokens inválidos',async({page})=>{
 // Only this browser fixture forces the unavailable presentation; API tests cover the actual configuration contract.
 await page.route('**/api/auth/email/status',route=>route.fulfill({json:{available:false}}));
 await page.goto('/entrar');
 await page.getByRole('link',{name:'Esqueci minha senha',exact:true}).click();
 await expect(page.getByRole('button',{name:'Solicitar recuperação'})).toBeDisabled();
 await expect(page.getByText('O envio de e-mails está indisponível no momento. Tente novamente mais tarde.')).toBeVisible();
 const invalidToken='x'.repeat(43);const seenUrls:string[]=[];
 page.on('request',r=>seenUrls.push(r.url()));
 await page.goto(`/redefinir-senha#token=${invalidToken}`);
 await expect(page).toHaveURL('http://localhost:3000/redefinir-senha');
 await page.getByLabel('Nova senha',{exact:true}).fill('Senha-nova-teste-123');
 await page.getByLabel('Confirme a nova senha',{exact:true}).fill('Senha-diferente-123');
 await page.getByRole('button',{name:'Salvar nova senha'}).click();
 await expect(page.getByRole('alert').filter({hasText:'As senhas precisam ser iguais.'})).toBeVisible();
 await page.getByLabel('Confirme a nova senha',{exact:true}).fill('Senha-nova-teste-123');
 await page.getByRole('button',{name:'Salvar nova senha'}).click();
 await expect(page.getByRole('alert').filter({hasText:'Link inválido ou expirado.'})).toBeVisible();
 await page.goto(`/verificar-email#token=${invalidToken}`);
 await expect(page).toHaveURL('http://localhost:3000/verificar-email');
 await page.getByRole('button',{name:'Confirmar meu e-mail'}).click();
 await expect(page.getByRole('alert').filter({hasText:'Link inválido ou expirado.'})).toBeVisible();
 expect(seenUrls.some(url=>url.includes(invalidToken))).toBe(false);
});
