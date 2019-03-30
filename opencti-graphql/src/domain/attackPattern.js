import { assoc, map, join } from 'ramda';
import uuid from 'uuid/v4';
import {
  deleteEntityById,
  getById,
  prepareDate,
  dayFormat,
  monthFormat,
  yearFormat,
  notify,
  now,
  paginate,
  takeWriteTx,
  prepareString
} from '../database/grakn';
import { BUS_TOPICS, logger } from '../config/conf';

export const findAll = args => {
  if (args.orderBy === 'killChainPhases') {
    const finalArgs = assoc('orderBy', 'phase_name', args);
    return paginate(
      `match $a isa Attack-Pattern; $rel(kill_chain_phase:$x, phase_belonging:$a) isa kill_chain_phases`,
      finalArgs,
      true,
      'x'
    );
  }
  return paginate('match $x isa Attack-Pattern', args);
};

export const findById = attackPatternId => getById(attackPatternId);

export const addAttackPattern = async (user, attackPattern) => {
  const wTx = await takeWriteTx();
  const query = `insert $attackPattern isa Attack-Pattern 
    has type "attack-pattern";
    $attackPattern has stix_id "${
      attackPattern.stix_id
        ? prepareString(attackPattern.stix_id)
        : `attack-patern--${uuid()}`
    }";
    $attackPattern has stix_label "";
    $attackPattern has alias "";
    $attackPattern has name "${prepareString(attackPattern.name)}";
    $attackPattern has description "${prepareString(
      attackPattern.description
    )}";
    ${
      attackPattern.platform
        ? join(
            ' ',
            map(
              platform =>
                `$attackPattern has platform "${prepareString(platform)}";`,
              attackPattern.platform
            )
          )
        : ''
    }
    ${
      attackPattern.required_permission
        ? join(
            ' ',
            map(
              requiredPermission =>
                `$attackPattern has required_permission "${prepareString(
                  requiredPermission
                )}";`,
              attackPattern.required_permission
            )
          )
        : ''
    }
    $attackPattern has created ${
      attackPattern.created ? prepareDate(attackPattern.created) : now()
    };
    $attackPattern has modified ${
      attackPattern.modified ? prepareDate(attackPattern.modified) : now()
    };
    $attackPattern has revoked false;
    $attackPattern has created_at ${now()};
    $attackPattern has created_at_day "${dayFormat(now())}";
    $attackPattern has created_at_month "${monthFormat(now())}";
    $attackPattern has created_at_year "${yearFormat(now())}";
    $attackPattern has updated_at ${now()};
  `;
  logger.debug(`[GRAKN - infer: false] ${query}`);
  const attackPatternIterator = await wTx.query(query);
  const createAttackPattern = await attackPatternIterator.next();
  const createdAttackPatternId = await createAttackPattern
    .map()
    .get('attackPattern').id;

  if (attackPattern.createdByRef) {
    await wTx.query(`match $from id ${createdAttackPatternId};
         $to id ${attackPattern.createdByRef};
         insert (so: $from, creator: $to)
         isa created_by_ref;`);
  }

  if (attackPattern.markingDefinitions) {
    const createMarkingDefinition = markingDefinition =>
      wTx.query(
        `match $from id ${createdAttackPatternId}; $to id ${markingDefinition}; insert (so: $from, marking: $to) isa object_marking_refs;`
      );
    const markingDefinitionsPromises = map(
      createMarkingDefinition,
      attackPattern.markingDefinitions
    );
    await Promise.all(markingDefinitionsPromises);
  }

  if (attackPattern.killChainPhases) {
    const createKillChainPhase = killChainPhase =>
      wTx.query(
        `match $from id ${createdAttackPatternId}; $to id ${killChainPhase}; insert (phase_belonging: $from, kill_chain_phase: $to) isa kill_chain_phases;`
      );
    const killChainPhasesPromises = map(
      createKillChainPhase,
      attackPattern.killChainPhases
    );
    await Promise.all(killChainPhasesPromises);
  }

  await wTx.commit();

  return getById(createdAttackPatternId).then(created =>
    notify(BUS_TOPICS.StixDomainEntity.ADDED_TOPIC, created, user)
  );
};

export const attackPatternDelete = attackPatternId =>
  deleteEntityById(attackPatternId);
