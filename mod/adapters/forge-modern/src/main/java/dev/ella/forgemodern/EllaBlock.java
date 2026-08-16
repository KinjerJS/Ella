package dev.ella.forgemodern;

import dev.ella.core.SlotSettings;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.DirectionProperty;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * Placeholder block reading its behaviour from a live {@link SlotSettings}.
 *
 * <p>Modern versions bake far more into {@link BlockBehaviour.Properties} than 1.12.2 did,
 * so a few properties cannot be made dynamic by overriding alone. Where that happens the
 * block is registered with the permissive choice and correctness is restored through a
 * method that <em>is</em> dynamic — see {@link #getLightBlock}.
 */
public class EllaBlock extends Block {

    /**
     * Stand-in used while {@link Block}'s constructor is still running.
     *
     * <p>Superclass constructors call overridable methods while building the default
     * block state, and this class's fields are not assigned until {@code super()} returns.
     * On 1.12.2 that reliably throws; here it may not, but relying on the difference
     * would be relying on the internals of a version this adapter is meant to outlive.
     */
    private static final SlotSettings DEFAULTS = new SlotSettings();

    private final SlotSettings settings;
    private final int slot;

    public EllaBlock(SlotSettings settings, int slot) {
        /*
         * `noOcclusion` is unconditional on purpose. Occlusion is baked into the block
         * state at construction, so a slot registered as occluding could never become
         * transparent later. Registering every slot as non-occluding costs a little chunk
         * render time and nothing visually, whereas the reverse would make transparency
         * impossible — the wrong trade for a modelling tool.
         *
         * Lighting, which occlusion would otherwise drive, is handled dynamically below.
         */
        super(BlockBehaviour.Properties.of()
            .strength(1.5f, 6.0f)
            .noOcclusion()
            .lightLevel(state -> 0));

        this.settings = settings;
        this.slot = slot;
        registerDefaultState(this.stateDefinition.any().setValue(FACING, Direction.NORTH));
    }

    // --- state ---------------------------------------------------------------

    /**
     * Orientation, present on every slot.
     *
     * <p>State properties are baked into the {@link net.minecraft.world.level.block.state.StateDefinition}
     * at construction, so a slot that might later be made rotatable has to carry the
     * property from the start. The {@code rotation} setting only decides whether
     * placement varies it.
     */
    public static final DirectionProperty FACING = BlockStateProperties.FACING;

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING);
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        String mode = live().rotation;

        if ("horizontal".equals(mode)) {
            // Facing the player, which is what furnaces and chests do.
            return defaultBlockState()
                .setValue(FACING, context.getHorizontalDirection().getOpposite());
        }
        if ("all".equals(mode)) {
            // The face that was clicked, like observers and pistons.
            return defaultBlockState().setValue(FACING, context.getClickedFace());
        }
        return defaultBlockState().setValue(FACING, Direction.NORTH);
    }

    /** Keeps orientation correct when a structure block rotates the world. */
    @Override
    protected BlockState rotate(BlockState state, Rotation rotation) {
        return state.setValue(FACING, rotation.rotate(state.getValue(FACING)));
    }

    @Override
    protected BlockState mirror(BlockState state, Mirror mirror) {
        return state.rotate(mirror.getRotation(state.getValue(FACING)));
    }

    public int slot() {
        return slot;
    }

    public SlotSettings settings() {
        return settings;
    }

    /** Live settings, or defaults while the superclass constructor is running. */
    private SlotSettings live() {
        SlotSettings current = settings;
        return current != null ? current : DEFAULTS;
    }

    // --- appearance ---------------------------------------------------------

    /*
     * There is no render-layer override here on purpose. From 1.19 Forge reads
     * `render_type` straight out of the model JSON, and Ella writes it into the slot's
     * redirect model — so the render layer is already a pure resource-pack concern on
     * this version, live on reload with no game-side call at all.
     */

    @Override
    public int getLightEmission(BlockState state, BlockGetter level, BlockPos pos) {
        return live().lightLevel;
    }

    /**
     * How much light the block blocks. This is what restores correct lighting for a
     * block registered as non-occluding: 15 makes it behave like a solid block again,
     * 0 lets light through.
     */
    @Override
    public int getLightBlock(BlockState state, BlockGetter level, BlockPos pos) {
        return live().opaque && live().fullCube ? 15 : 0;
    }

    @Override
    public boolean propagatesSkylightDown(BlockState state, BlockGetter level, BlockPos pos) {
        return !(live().opaque && live().fullCube);
    }

    // --- physical -----------------------------------------------------------

    @Override
    public float getDestroyProgress(BlockState state, Player player, BlockGetter level,
                                    BlockPos pos) {
        // Hardness is baked into Properties, so dynamic hardness has to be expressed as
        // mining speed instead. -1 means unbreakable, matching vanilla's convention.
        float hardness = live().hardness;
        if (hardness < 0) return 0.0f;
        if (hardness == 0) return 1.0f;

        // Forge's BlockPos-aware overload, so tool and enchantment modifiers apply.
        float speed = player.getDestroySpeed(state, pos);
        return speed / hardness / 30.0f;
    }

    @Override
    public SoundType getSoundType(BlockState state, LevelReader level, BlockPos pos,
                                  Entity entity) {
        return Sounds.byName(live().soundType);
    }

    // --- shape --------------------------------------------------------------

    @Override
    public VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos,
                               CollisionContext context) {
        if (!"custom".equals(live().collision)) return Shapes.block();

        float[] box = live().hitboxNormalised();
        return Shapes.box(box[0], box[1], box[2], box[3], box[4], box[5]);
    }

    @Override
    public VoxelShape getCollisionShape(BlockState state, BlockGetter level, BlockPos pos,
                                        CollisionContext context) {
        if ("none".equals(live().collision)) return Shapes.empty();
        return getShape(state, level, pos, context);
    }

    @Override
    public VoxelShape getOcclusionShape(BlockState state, BlockGetter level, BlockPos pos) {
        // A non-full block must not cast a full-cube shadow.
        return live().fullCube && live().opaque ? Shapes.block() : Shapes.empty();
    }

    @Override
    protected boolean skipRendering(BlockState state, BlockState neighbour,
                                    net.minecraft.core.Direction side) {
        // Only hide the shared face between two identical opaque full cubes; doing it for
        // transparent blocks is what makes stacked glass look hollow.
        if (!live().opaque || !live().fullCube) return false;
        return neighbour.is(this);
    }
}
