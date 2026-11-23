/**
 * Cria o usuário administrador inicial.
 *
 * Idempotente: se o e-mail já existir, apenas garante a role `admin` e sai.
 *
 * O cadastro público está desativado (`disableSignUp`), e criar usuário pela
 * API de admin exigiria uma sessão de admin — que ainda não existe no primeiro
 * boot. Por isso o seed chama a API interna do Better Auth diretamente, que
 * gera o hash da senha do mesmo jeito que o fluxo normal.
 *
 * Roda de duas formas:
 *   - `pnpm db:seed`, na mão, em qualquer ambiente;
 *   - no boot do container, antes da API subir (ver o CMD do Dockerfile). Em
 *     produção, só quando a base ainda não tem nenhum usuário.
 *
 * A credencial vem de `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`. Em produção,
 * sem as duas, nenhum admin é criado. Fora de produção vale a credencial de
 * desenvolvimento abaixo, a MESMA em todo projeto que clonar o Rubik: é só para
 * `pnpm dev`. Em produção, o seed só roda contra base vazia.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { auth } from 'src/modules/auth/auth';
import { env, isProduction } from 'src/config/env';
import { db, queryClient } from 'src/db/db.provider';
import { user } from 'src/db/schema/auth';
import { role } from 'src/db/schema/role';
import { PERMISSIONS } from 'src/modules/roles/types/role.types';

const SEED_NAME = 'Desenvolvedor';
const DEV_EMAIL = 'desenvolvedor@letsup.team';
const DEV_PASSWORD = '123mudar';

type SeedAdmin = { email: string; password: string; fromEnv: boolean };

function resolveSeedAdmin(): SeedAdmin | null {
	if (env.SEED_ADMIN_EMAIL !== '' && env.SEED_ADMIN_PASSWORD !== '') {
		return { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, fromEnv: true };
	}
	// `localhost` escapa pelo mesmo motivo do `config/env.ts`: é o smoke test das
	// imagens de produção (`pnpm docker:prod`), não um deploy de verdade.
	const authHost = new URL(env.BETTER_AUTH_URL).hostname;
	const isLocalSmokeTest = authHost === 'localhost' || authHost === '127.0.0.1';
	if (isProduction && !isLocalSmokeTest) {
		return null;
	}
	return { email: DEV_EMAIL, password: DEV_PASSWORD, fromEnv: false };
}

function log(message: string): void {
	process.stdout.write(`[seed] ${message}\n`);
}

async function promoteToAdmin(id: string): Promise<void> {
	await db.update(user).set({ role: 'admin' }).where(eq(user.id, id));
}

/** Cargos de sistema: o RolesGuard depende de `admin` existir. */
async function seedSystemRoles(): Promise<void> {
	const systemRoles = [
		{
			name: 'admin',
			description: 'Acesso total ao sistema.',
			permissions: PERMISSIONS.join(','),
			color: 'primary',
			icon: 'escudo',
		},
		{
			name: 'user',
			description: 'Acesso às áreas comuns.',
			permissions: '',
			color: 'neutral',
			icon: 'pessoa',
		},
	];

	for (const item of systemRoles) {
		const [existing] = await db
			.select({ id: role.id, permissions: role.permissions })
			.from(role)
			.where(eq(role.name, item.name))
			.limit(1);

		if (existing) {
			// Permissão nova em `PERMISSIONS` precisa chegar ao admin sem SQL manual.
			if (item.name === 'admin' && existing.permissions !== item.permissions) {
				await db
					.update(role)
					.set({ permissions: item.permissions })
					.where(eq(role.id, existing.id));
				log('permissões do cargo admin atualizadas');
			}
			continue;
		}

		await db.insert(role).values({ id: randomUUID(), isSystem: true, ...item });
		log(`cargo de sistema criado: ${item.name}`);
	}
}

/**
 * Há algum usuário nesta base?
 *
 * É o que distingue "primeiro boot" de "aplicação em uso". Em produção o seed
 * só roda quando a resposta é não: num sistema que já tem gente dentro, criar
 * um admin de credencial conhecida seria abrir uma porta, não inicializar.
 */
async function isFirstBoot(): Promise<boolean> {
	const [any] = await db.select({ id: user.id }).from(user).limit(1);
	return any === undefined;
}

async function seed(): Promise<void> {
	// Em produção o seed é de INICIALIZAÇÃO, não de manutenção: roda no primeiro
	// boot contra um banco vazio e nunca mais. Fora de produção roda sempre,
	// porque é o que faz `pnpm db:seed` reparar um ambiente local bagunçado.
	if (isProduction && !(await isFirstBoot())) {
		log('base já tem usuários: seed de inicialização ignorado.');
		return;
	}

	await seedSystemRoles();

	const admin = resolveSeedAdmin();
	if (!admin) {
		log('SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD ausentes: admin inicial não criado.');
		return;
	}

	const [existing] = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.email, admin.email))
		.limit(1);

	if (existing) {
		if (existing.role?.split(',').includes('admin')) {
			log(`${admin.email} já existe e é admin. Nada a fazer.`);
			return;
		}
		await promoteToAdmin(existing.id);
		log(`${admin.email} já existia; promovido a admin.`);
		return;
	}

	// `createUser` do plugin admin não passa por `disableSignUp`.
	// Chamado server-side, sem sessão, pois este é o primeiro admin.
	const created = await auth.api.createUser({
		body: { name: SEED_NAME, email: admin.email, password: admin.password, role: 'admin' },
	});

	if (!created.user?.id) {
		throw new Error('usuário não retornado pelo Better Auth');
	}

	await promoteToAdmin(created.user.id);

	// A senha de SEED_ADMIN_PASSWORD nunca vai para o log; a de desenvolvimento é pública.
	if (admin.fromEnv) {
		log(`admin criado: ${admin.email}`);
		return;
	}
	log(`admin criado: ${admin.email} / ${admin.password}`);
	log('troque a senha antes de expor esta aplicação.');
}

seed()
	.catch((error: unknown) => {
		log(`erro: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	})
	.finally(() => {
		void queryClient.end({ timeout: 5 });
	});
